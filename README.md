# Library Database API

A small REST API for managing a library catalog, patrons, and book loans. The server is JavaScript on Node.js and stores data in SQLite. A .NET console client demonstrates the same API using typed C# models.

## Requirements

- Node.js 22.13 or newer (uses the built-in `node:sqlite` module; no npm dependencies)
- .NET 10 SDK to build and run the optional C# client

## Run the API

From the repository root:

```sh
npm start
```

The API listens on `http://localhost:3000`. The SQLite database is created at `data/library.db` on first start. Configure the listener and database location with `PORT`, `HOST`, and `DATABASE_PATH`:

```sh
PORT=8080 DATABASE_PATH=./library.db npm start
```

Set `DATABASE_PATH=:memory:` to use a temporary in-memory database. `GET /health` returns `{"status":"ok"}` when the server is running.

## API conventions

- All request and response bodies are JSON, encoded as UTF-8.
- IDs are positive integers. Timestamps are UTC ISO 8601 strings.
- Lists accept `limit` (default `50`, maximum `100`) and `offset` (default `0`). Responses have the shape `{"items":[],"limit":50,"offset":0}`.
- Errors have the shape `{"error":{"code":"...","message":"..."}}`.
- `400` means invalid JSON, input, or query parameter; `404` means the requested record does not exist; `409` means a uniqueness, availability, or loan-state conflict; `413` means the request body exceeds 1 MB; unexpected failures return `500`.

### Books

`GET /api/books?q=tolkien&available=true&limit=20&offset=0` lists books. `q` searches title, author, and ISBN without case sensitivity. `available` is optional and must be `true` or `false`. Each book includes `availableCopies`, computed from its active loans.

`GET /api/books/{id}` returns one book or `404`.

`POST /api/books` creates a book and returns `201` with its record:

```json
{
	"isbn": "9780547928227",
	"title": "The Hobbit",
	"author": "J. R. R. Tolkien",
	"publicationYear": 1937,
	"totalCopies": 3
}
```

`isbn` and `publicationYear` may be `null` or omitted. ISBNs must be unique when supplied. `title` and `author` must be non-empty strings; `totalCopies` must be a positive integer (default `1`); `publicationYear`, when supplied, must be an integer from 0 through 9999.

### Patrons

`GET /api/patrons?q=lee&limit=50&offset=0` lists patrons. `q` searches name and email.

`GET /api/patrons/{id}` returns one patron or `404`.

`POST /api/patrons` creates a patron and returns `201`:

```json
{"name":"Morgan Lee","email":"morgan@example.com"}
```

Both fields must be non-empty strings. Email addresses are unique without regard to case.

### Loans

`GET /api/loans?status=active&patronId=1&bookId=2&limit=50&offset=0` lists loans. `status` may be `active` or `returned`; IDs are optional positive integers. A loan includes nested `book` and `patron` summaries, `checkedOutAt`, `dueDate`, and `returnedAt` (`null` while active).

`POST /api/loans` checks out a copy and returns `201`:

```json
{"bookId":1,"patronId":1,"dueDate":"2026-11-06"}
```

The due date must be a real calendar date in `YYYY-MM-DD` form. The API returns `404` when the book or patron does not exist and `409` when no copies are available.

`POST /api/loans/{id}/return` returns an active loan and responds with the updated loan. It returns `404` for an unknown loan and `409` if it has already been returned.

## Examples

Create a book and patron, then check out the book (assuming IDs `1` for each):

```sh
curl -s http://localhost:3000/api/books \
	-H 'Content-Type: application/json' \
	-d '{"title":"The Hobbit","author":"J. R. R. Tolkien","totalCopies":1}'

curl -s http://localhost:3000/api/patrons \
	-H 'Content-Type: application/json' \
	-d '{"name":"Morgan Lee","email":"morgan@example.com"}'

curl -s http://localhost:3000/api/loans \
	-H 'Content-Type: application/json' \
	-d '{"bookId":1,"patronId":1,"dueDate":"2026-11-06"}'
```

## Run tests

```sh
npm test
```

Tests use Node's built-in test runner and an isolated in-memory SQLite database.

## C# client

The console client targets .NET 10 and calls the running API. In another terminal:

```sh
dotnet run --project clients/csharp/LibraryApiClient.csproj
```

It prints the health status and the first page of books. Set `LIBRARY_API_URL` to use a different API base URL, for example `LIBRARY_API_URL=http://localhost:8080 dotnet run --project clients/csharp/LibraryApiClient.csproj`. `LibraryApiClient.cs` also exposes methods to list and create books/patrons, check out a book, and return a loan.

## Project layout

```text
src/server.js                 HTTP routes and request validation
src/database.js               SQLite schema and data operations
test/api.test.js               API integration tests
clients/csharp/                .NET console client and typed models
```