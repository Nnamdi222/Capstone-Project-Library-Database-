import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createLibraryServer } from '../src/server.js';

let app;
let baseUrl;

beforeEach(async () => {
  app = createLibraryServer({ databasePath: ':memory:' });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${app.server.address().port}`;
});

afterEach(async () => {
  await app.close();
});

async function post(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('health endpoint reports ready', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('browser dashboard and its assets are served by the API origin', async () => {
  const [page, script, stylesheet] = await Promise.all([
    fetch(`${baseUrl}/`),
    fetch(`${baseUrl}/app.js`),
    fetch(`${baseUrl}/styles.css`),
  ]);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /Good Shelf/);
  assert.match(script.headers.get('content-type'), /javascript/);
  assert.match(await script.text(), /function renderCurrent/);
  assert.match(stylesheet.headers.get('content-type'), /text\/css/);
});

test('book and patron creation enforce unique identifiers', async () => {
  const book = await post('/api/books', {
    isbn: '9780547928227', title: 'The Hobbit', author: 'J. R. R. Tolkien', totalCopies: 1,
  });
  assert.equal(book.status, 201);
  assert.equal((await book.json()).availableCopies, 1);

  const duplicateBook = await post('/api/books', {
    isbn: '9780547928227', title: 'Duplicate', author: 'Someone',
  });
  assert.equal(duplicateBook.status, 409);

  assert.equal((await post('/api/patrons', { name: 'Morgan Lee', email: 'morgan@example.com' })).status, 201);
  assert.equal((await post('/api/patrons', { name: 'Morgan Lee', email: 'MORGAN@example.com' })).status, 409);
});

test('checkout consumes a copy and return restores availability', async () => {
  const bookResponse = await post('/api/books', { title: 'Dune', author: 'Frank Herbert', totalCopies: 1 });
  const book = await bookResponse.json();
  const patronResponse = await post('/api/patrons', { name: 'Avery Chen', email: 'avery@example.com' });
  const patron = await patronResponse.json();

  const checkout = await post('/api/loans', { bookId: book.id, patronId: patron.id, dueDate: '2026-11-06' });
  assert.equal(checkout.status, 201);
  const loan = await checkout.json();
  assert.equal(loan.returnedAt, null);
  assert.equal(loan.book.title, 'Dune');

  const unavailable = await post('/api/loans', { bookId: book.id, patronId: patron.id, dueDate: '2026-11-06' });
  assert.equal(unavailable.status, 409);
  assert.equal((await (await fetch(`${baseUrl}/api/books/${book.id}`)).json()).availableCopies, 0);
  const unavailableBooks = await fetch(`${baseUrl}/api/books?available=false`);
  assert.deepEqual((await unavailableBooks.json()).items.map((item) => item.id), [book.id]);

  const returned = await post(`/api/loans/${loan.id}/return`, {});
  assert.equal(returned.status, 200);
  assert.ok((await returned.json()).returnedAt);
  assert.equal((await (await fetch(`${baseUrl}/api/books?available=true`)).json()).items.length, 1);
  assert.equal((await post(`/api/loans/${loan.id}/return`, {})).status, 409);
});

test('invalid input and missing resources use documented errors', async () => {
  const invalidBook = await post('/api/books', { title: ' ', author: 'Author' });
  assert.equal(invalidBook.status, 400);
  assert.equal((await invalidBook.json()).error.code, 'invalid_field');
  assert.equal((await post('/api/books', { title: 'Valid', author: 'Author', totalCopies: '2' })).status, 400);

  const invalidLoan = await post('/api/loans', { bookId: 1, patronId: 1, dueDate: '2026-02-30' });
  assert.equal(invalidLoan.status, 400);

  const missing = await fetch(`${baseUrl}/api/books/999`);
  assert.equal(missing.status, 404);
});

test('list endpoints filter and paginate results', async () => {
  await post('/api/books', { title: 'The Hobbit', author: 'Tolkien' });
  await post('/api/books', { title: 'Dune', author: 'Herbert' });
  const response = await fetch(`${baseUrl}/api/books?q=tolkien&limit=1&offset=0`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json().then(({ items, limit, offset }) => ({
    titles: items.map((book) => book.title), limit, offset,
  })), { titles: ['The Hobbit'], limit: 1, offset: 0 });
});