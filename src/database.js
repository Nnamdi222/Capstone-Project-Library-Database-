import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const availableCopiesExpression = `b.total_copies - (
  SELECT COUNT(*) FROM loans l
  WHERE l.book_id = b.id AND l.returned_at IS NULL
)`;

const bookSelect = `
  SELECT b.id, b.isbn, b.title, b.author, b.publication_year,
         b.total_copies, ${availableCopiesExpression} AS available_copies,
         b.created_at
  FROM books b`;

function mapBook(row) {
  if (!row) return null;
  return {
    id: row.id,
    isbn: row.isbn,
    title: row.title,
    author: row.author,
    publicationYear: row.publication_year,
    totalCopies: row.total_copies,
    availableCopies: row.available_copies,
    createdAt: row.created_at,
  };
}

function mapPatron(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at,
  };
}

function mapLoan(row) {
  if (!row) return null;
  return {
    id: row.id,
    bookId: row.book_id,
    patronId: row.patron_id,
    checkedOutAt: row.checked_out_at,
    dueDate: row.due_date,
    returnedAt: row.returned_at,
    book: { id: row.book_id, title: row.book_title, author: row.book_author },
    patron: { id: row.patron_id, name: row.patron_name, email: row.patron_email },
  };
}

const loanSelect = `
  SELECT l.id, l.book_id, l.patron_id, l.checked_out_at, l.due_date,
         l.returned_at, b.title AS book_title, b.author AS book_author,
         p.name AS patron_name, p.email AS patron_email
  FROM loans l
  JOIN books b ON b.id = l.book_id
  JOIN patrons p ON p.id = l.patron_id`;

export function openDatabase(databasePath) {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  }

  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY,
      isbn TEXT UNIQUE,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      author TEXT NOT NULL CHECK (length(trim(author)) > 0),
      publication_year INTEGER CHECK (publication_year BETWEEN 0 AND 9999),
      total_copies INTEGER NOT NULL DEFAULT 1 CHECK (total_copies > 0),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE IF NOT EXISTS patrons (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE IF NOT EXISTS loans (
      id INTEGER PRIMARY KEY,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
      patron_id INTEGER NOT NULL REFERENCES patrons(id) ON DELETE RESTRICT,
      checked_out_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      due_date TEXT NOT NULL,
      returned_at TEXT
    );
    CREATE INDEX IF NOT EXISTS loans_book_active ON loans(book_id, returned_at);
    CREATE INDEX IF NOT EXISTS loans_patron ON loans(patron_id);
  `);

  return {
    close: () => database.close(),
    findBook(id) {
      return mapBook(database.prepare(`${bookSelect} WHERE b.id = ?`).get(id));
    },
    listBooks({ search, available, limit, offset }) {
      const clauses = [];
      const values = [];
      if (search) {
        clauses.push('(b.title LIKE ? COLLATE NOCASE OR b.author LIKE ? COLLATE NOCASE OR b.isbn LIKE ? COLLATE NOCASE)');
        const term = `%${search}%`;
        values.push(term, term, term);
      }
      if (available !== undefined) clauses.push(`(${availableCopiesExpression}) ${available ? '>' : '='} 0`);
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      const rows = database.prepare(`${bookSelect}${where} ORDER BY b.title COLLATE NOCASE, b.id LIMIT ? OFFSET ?`)
        .all(...values, limit, offset);
      return rows.map(mapBook);
    },
    createBook(book) {
      const result = database.prepare(`
        INSERT INTO books (isbn, title, author, publication_year, total_copies)
        VALUES (?, ?, ?, ?, ?)
      `).run(book.isbn, book.title, book.author, book.publicationYear, book.totalCopies);
      return this.findBook(Number(result.lastInsertRowid));
    },
    isbnExists(isbn) {
      return Boolean(database.prepare('SELECT 1 FROM books WHERE isbn = ?').get(isbn));
    },
    hasLoansForBook(id) {
      return Boolean(database.prepare('SELECT 1 FROM loans WHERE book_id = ? LIMIT 1').get(id));
    },
    deleteBook(id) {
      return database.prepare('DELETE FROM books WHERE id = ?').run(id).changes > 0;
    },
    findPatron(id) {
      return mapPatron(database.prepare('SELECT * FROM patrons WHERE id = ?').get(id));
    },
    listPatrons({ search, limit, offset }) {
      const values = [];
      let where = '';
      if (search) {
        where = 'WHERE name LIKE ? COLLATE NOCASE OR email LIKE ? COLLATE NOCASE';
        const term = `%${search}%`;
        values.push(term, term);
      }
      const rows = database.prepare(`SELECT * FROM patrons ${where} ORDER BY name COLLATE NOCASE, id LIMIT ? OFFSET ?`)
        .all(...values, limit, offset);
      return rows.map(mapPatron);
    },
    createPatron(patron) {
      const result = database.prepare('INSERT INTO patrons (name, email) VALUES (?, ?)')
        .run(patron.name, patron.email);
      return this.findPatron(Number(result.lastInsertRowid));
    },
    emailExists(email) {
      return Boolean(database.prepare('SELECT 1 FROM patrons WHERE email = ? COLLATE NOCASE').get(email));
    },
    hasLoansForPatron(id) {
      return Boolean(database.prepare('SELECT 1 FROM loans WHERE patron_id = ? LIMIT 1').get(id));
    },
    deletePatron(id) {
      return database.prepare('DELETE FROM patrons WHERE id = ?').run(id).changes > 0;
    },
    listLoans({ status, patronId, bookId, limit, offset }) {
      const clauses = [];
      const values = [];
      if (status === 'active') clauses.push('l.returned_at IS NULL');
      if (status === 'returned') clauses.push('l.returned_at IS NOT NULL');
      if (patronId !== undefined) {
        clauses.push('l.patron_id = ?');
        values.push(patronId);
      }
      if (bookId !== undefined) {
        clauses.push('l.book_id = ?');
        values.push(bookId);
      }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      const rows = database.prepare(`${loanSelect}${where} ORDER BY l.id DESC LIMIT ? OFFSET ?`)
        .all(...values, limit, offset);
      return rows.map(mapLoan);
    },
    createLoan({ bookId, patronId, dueDate }) {
      const result = database.prepare('INSERT INTO loans (book_id, patron_id, due_date) VALUES (?, ?, ?)')
        .run(bookId, patronId, dueDate);
      return this.findLoan(Number(result.lastInsertRowid));
    },
    findLoan(id) {
      return mapLoan(database.prepare(`${loanSelect} WHERE l.id = ?`).get(id));
    },
    activeLoanCount(bookId) {
      return database.prepare('SELECT COUNT(*) AS count FROM loans WHERE book_id = ? AND returned_at IS NULL')
        .get(bookId).count;
    },
    returnLoan(id) {
      const returnedAt = new Date().toISOString();
      const result = database.prepare('UPDATE loans SET returned_at = ? WHERE id = ? AND returned_at IS NULL')
        .run(returnedAt, id);
      return result.changes ? this.findLoan(id) : null;
    },
  };
}