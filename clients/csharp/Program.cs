using LibraryApiClient;

var baseAddress = Environment.GetEnvironmentVariable("LIBRARY_API_URL") ?? "http://localhost:3000";
using var httpClient = new HttpClient
{
    BaseAddress = new Uri(baseAddress.TrimEnd('/') + "/"),
    Timeout = TimeSpan.FromSeconds(10),
};

var library = new LibraryApiClient.LibraryApiClient(httpClient);
var health = await library.GetHealthAsync();
var books = await library.ListBooksAsync();

Console.WriteLine($"API status: {health.Status}");
Console.WriteLine($"Books ({books.Items.Count} shown):");
foreach (var book in books.Items)
{
    Console.WriteLine($"{book.Id}: {book.Title} by {book.Author} ({book.AvailableCopies}/{book.TotalCopies} available)");
}