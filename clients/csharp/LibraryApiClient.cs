using System.Net.Http.Json;

namespace LibraryApiClient;

public sealed class LibraryApiClient(HttpClient httpClient)
{
    public async Task<ApiHealth> GetHealthAsync(CancellationToken cancellationToken = default) =>
        await GetRequiredAsync<ApiHealth>("health", cancellationToken);

    public async Task<Page<Book>> ListBooksAsync(
        string? search = null,
        bool? available = null,
        int limit = 50,
        int offset = 0,
        CancellationToken cancellationToken = default)
    {
        var query = new List<string> { $"limit={limit}", $"offset={offset}" };
        if (!string.IsNullOrWhiteSpace(search)) query.Add($"q={Uri.EscapeDataString(search)}");
        if (available.HasValue) query.Add($"available={available.Value.ToString().ToLowerInvariant()}");
        return await GetRequiredAsync<Page<Book>>($"api/books?{string.Join('&', query)}", cancellationToken);
    }

    public async Task<Book> GetBookAsync(int id, CancellationToken cancellationToken = default) =>
        await GetRequiredAsync<Book>($"api/books/{id}", cancellationToken);

    public async Task<Book> CreateBookAsync(CreateBookRequest book, CancellationToken cancellationToken = default) =>
        await PostRequiredAsync<Book>("api/books", book, cancellationToken);

    public async Task<Page<Patron>> ListPatronsAsync(
        string? search = null,
        int limit = 50,
        int offset = 0,
        CancellationToken cancellationToken = default)
    {
        var query = new List<string> { $"limit={limit}", $"offset={offset}" };
        if (!string.IsNullOrWhiteSpace(search)) query.Add($"q={Uri.EscapeDataString(search)}");
        return await GetRequiredAsync<Page<Patron>>($"api/patrons?{string.Join('&', query)}", cancellationToken);
    }

    public async Task<Patron> CreatePatronAsync(CreatePatronRequest patron, CancellationToken cancellationToken = default) =>
        await PostRequiredAsync<Patron>("api/patrons", patron, cancellationToken);

    public async Task<Page<Loan>> ListLoansAsync(
        string? status = null,
        int? patronId = null,
        int? bookId = null,
        int limit = 50,
        int offset = 0,
        CancellationToken cancellationToken = default)
    {
        var query = new List<string> { $"limit={limit}", $"offset={offset}" };
        if (status is not null) query.Add($"status={Uri.EscapeDataString(status)}");
        if (patronId.HasValue) query.Add($"patronId={patronId.Value}");
        if (bookId.HasValue) query.Add($"bookId={bookId.Value}");
        return await GetRequiredAsync<Page<Loan>>($"api/loans?{string.Join('&', query)}", cancellationToken);
    }

    public async Task<Loan> CheckoutAsync(CreateLoanRequest loan, CancellationToken cancellationToken = default) =>
        await PostRequiredAsync<Loan>("api/loans", loan, cancellationToken);

    public async Task<Loan> ReturnLoanAsync(int id, CancellationToken cancellationToken = default) =>
        await PostRequiredAsync<Loan>($"api/loans/{id}/return", new { }, cancellationToken);

    private async Task<T> GetRequiredAsync<T>(string path, CancellationToken cancellationToken)
    {
        using var response = await httpClient.GetAsync(path, cancellationToken);
        return await ReadRequiredAsync<T>(response, cancellationToken);
    }

    private async Task<T> PostRequiredAsync<T>(string path, object body, CancellationToken cancellationToken)
    {
        using var response = await httpClient.PostAsJsonAsync(path, body, cancellationToken);
        return await ReadRequiredAsync<T>(response, cancellationToken);
    }

    private static async Task<T> ReadRequiredAsync<T>(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (!response.IsSuccessStatusCode)
        {
            var details = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new HttpRequestException(
                $"Library API returned {(int)response.StatusCode} ({response.StatusCode}): {details}",
                null,
                response.StatusCode);
        }

        return await response.Content.ReadFromJsonAsync<T>(cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("Library API returned an empty response.");
    }
}