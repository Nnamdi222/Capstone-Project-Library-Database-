import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { openDatabase } from './database.js';

const MAX_BODY_BYTES = 1024 * 1024;
const staticAssets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function requireObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'invalid_body', 'Request body must be a JSON object.');
  }
  return value;
}

function requiredString(body, field) {
  const value = body[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError(400, 'invalid_field', `${field} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalYear(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 0 || value > 9999) {
    throw new ApiError(400, 'invalid_field', 'publicationYear must be an integer from 0 through 9999.');
  }
  return value;
}

function positiveInteger(value, field) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new ApiError(400, 'invalid_field', `${field} must be a positive integer.`);
  }
  return parsed;
}

function bodyPositiveInteger(value, field) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new ApiError(400, 'invalid_field', `${field} must be a positive integer.`);
  }
  return value;
}

function pagination(url) {
  const parse = (field, fallback, maximum = Number.MAX_SAFE_INTEGER) => {
    const raw = url.searchParams.get(field);
    if (raw === null) return fallback;
    if (!/^\d+$/.test(raw)) throw new ApiError(400, 'invalid_query', `${field} must be a non-negative integer.`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value > maximum) {
      throw new ApiError(400, 'invalid_query', `${field} must be no greater than ${maximum}.`);
    }
    return value;
  };
  const limit = parse('limit', 50, 100);
  const offset = parse('offset', 0);
  if (limit < 1) throw new ApiError(400, 'invalid_query', 'limit must be at least 1.');
  return { limit, offset };
}

function queryId(url, field) {
  const raw = url.searchParams.get(field);
  return raw === null ? undefined : positiveInteger(raw, field);
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ApiError(413, 'body_too_large', 'Request body exceeds 1 MB.');
    chunks.push(chunk);
  }
  try {
    return requireObject(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'invalid_json', 'Request body must contain valid JSON.');
  }
}

function paged(items, { limit, offset }) {
  return { items, limit, offset };
}

export function createLibraryServer({ databasePath = process.env.DATABASE_PATH ?? 'data/library.db' } = {}) {
  const database = openDatabase(databasePath);

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const method = request.method;
      const path = url.pathname;

      if (method === 'GET' && staticAssets.has(path)) {
        const [fileName, contentType] = staticAssets.get(path);
        const content = await readFile(new URL(`../${fileName}`, import.meta.url));
        response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
        response.end(content);
        return;
      }

      if (method === 'GET' && path === '/health') {
        return sendJson(response, 200, { status: 'ok' });
      }

      if (method === 'GET' && path === '/api/books') {
        const page = pagination(url);
        const availableRaw = url.searchParams.get('available');
        if (availableRaw !== null && availableRaw !== 'true' && availableRaw !== 'false') {
          throw new ApiError(400, 'invalid_query', 'available must be true or false.');
        }
        const items = database.listBooks({
          ...page,
          search: url.searchParams.get('q')?.trim() ?? '',
          available: availableRaw === null ? undefined : availableRaw === 'true',
        });
        return sendJson(response, 200, paged(items, page));
      }

      const bookMatch = path.match(/^\/api\/books\/(\d+)$/);
      if (method === 'GET' && bookMatch) {
        const book = database.findBook(positiveInteger(bookMatch[1], 'id'));
        if (!book) throw new ApiError(404, 'not_found', 'Book not found.');
        return sendJson(response, 200, book);
      }

      if (method === 'POST' && path === '/api/books') {
        const body = await readJson(request);
        const isbn = body.isbn === undefined || body.isbn === null ? null : requiredString(body, 'isbn');
        const totalCopies = body.totalCopies === undefined ? 1 : bodyPositiveInteger(body.totalCopies, 'totalCopies');
        const book = {
          isbn,
          title: requiredString(body, 'title'),
          author: requiredString(body, 'author'),
          publicationYear: optionalYear(body.publicationYear),
          totalCopies,
        };
        if (isbn && database.isbnExists(isbn)) throw new ApiError(409, 'conflict', 'A book with this ISBN already exists.');
        return sendJson(response, 201, database.createBook(book));
      }

      if (method === 'GET' && path === '/api/patrons') {
        const page = pagination(url);
        const items = database.listPatrons({ ...page, search: url.searchParams.get('q')?.trim() ?? '' });
        return sendJson(response, 200, paged(items, page));
      }

      const patronMatch = path.match(/^\/api\/patrons\/(\d+)$/);
      if (method === 'GET' && patronMatch) {
        const patron = database.findPatron(positiveInteger(patronMatch[1], 'id'));
        if (!patron) throw new ApiError(404, 'not_found', 'Patron not found.');
        return sendJson(response, 200, patron);
      }

      if (method === 'POST' && path === '/api/patrons') {
        const body = await readJson(request);
        const patron = { name: requiredString(body, 'name'), email: requiredString(body, 'email') };
        if (database.emailExists(patron.email)) throw new ApiError(409, 'conflict', 'A patron with this email already exists.');
        return sendJson(response, 201, database.createPatron(patron));
      }

      if (method === 'GET' && path === '/api/loans') {
        const page = pagination(url);
        const status = url.searchParams.get('status') ?? undefined;
        if (status !== undefined && status !== 'active' && status !== 'returned') {
          throw new ApiError(400, 'invalid_query', 'status must be active or returned.');
        }
        const items = database.listLoans({
          ...page,
          status,
          patronId: queryId(url, 'patronId'),
          bookId: queryId(url, 'bookId'),
        });
        return sendJson(response, 200, paged(items, page));
      }

      if (method === 'POST' && path === '/api/loans') {
        const body = await readJson(request);
        const bookId = bodyPositiveInteger(body.bookId, 'bookId');
        const patronId = bodyPositiveInteger(body.patronId, 'patronId');
        if (!isValidDate(body.dueDate)) {
          throw new ApiError(400, 'invalid_field', 'dueDate must be a real date in YYYY-MM-DD format.');
        }
        const book = database.findBook(bookId);
        if (!book) throw new ApiError(404, 'not_found', 'Book not found.');
        if (!database.findPatron(patronId)) throw new ApiError(404, 'not_found', 'Patron not found.');
        if (database.activeLoanCount(bookId) >= book.totalCopies) {
          throw new ApiError(409, 'unavailable', 'No copies of this book are currently available.');
        }
        return sendJson(response, 201, database.createLoan({ bookId, patronId, dueDate: body.dueDate }));
      }

      const returnMatch = path.match(/^\/api\/loans\/(\d+)\/return$/);
      if (method === 'POST' && returnMatch) {
        const id = positiveInteger(returnMatch[1], 'id');
        const existing = database.findLoan(id);
        if (!existing) throw new ApiError(404, 'not_found', 'Loan not found.');
        if (existing.returnedAt) throw new ApiError(409, 'conflict', 'This loan has already been returned.');
        return sendJson(response, 200, database.returnLoan(id));
      }

      throw new ApiError(404, 'not_found', 'Route not found.');
    } catch (error) {
      if (error instanceof ApiError) {
        return sendJson(response, error.status, { error: { code: error.code, message: error.message } });
      }
      console.error(error);
      return sendJson(response, 500, { error: { code: 'internal_error', message: 'An unexpected error occurred.' } });
    }
  });

  return {
    server,
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          database.close();
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';
  const { server } = createLibraryServer();
  server.listen(port, host, () => console.log(`Library API listening on http://${host}:${port}`));
}