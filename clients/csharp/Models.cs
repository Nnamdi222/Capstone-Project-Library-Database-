namespace LibraryApiClient;

public sealed record ApiHealth(string Status);

public sealed record Book(
    int Id,
    string? Isbn,
    string Title,
    string Author,
    int? PublicationYear,
    int TotalCopies,
    int AvailableCopies,
    string CreatedAt);

public sealed record Patron(int Id, string Name, string Email, string CreatedAt);

public sealed record BookSummary(int Id, string Title, string Author);

public sealed record PatronSummary(int Id, string Name, string Email);

public sealed record Loan(
    int Id,
    int BookId,
    int PatronId,
    string CheckedOutAt,
    string DueDate,
    string? ReturnedAt,
    BookSummary Book,
    PatronSummary Patron);

public sealed record Page<T>(IReadOnlyList<T> Items, int Limit, int Offset);

public sealed record CreateBookRequest(
    string Title,
    string Author,
    string? Isbn = null,
    int? PublicationYear = null,
    int TotalCopies = 1);

public sealed record CreatePatronRequest(string Name, string Email);

public sealed record CreateLoanRequest(int BookId, int PatronId, string DueDate);