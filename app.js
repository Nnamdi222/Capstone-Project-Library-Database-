const pageSize = 50;
const covers = ['#d9654b', '#477b66', '#567e9b', '#d0a33f', '#8b7195', '#497d83'];
const state = {
  view: 'books',
  query: '',
  offsets: { books: 0, patrons: 0, loans: 0 },
  books: [],
  patrons: [],
  activeLoans: [],
  toastTimer: null,
  selectedBookId: null,
};

const elements = {
  collection: document.querySelector('#collection'),
  summary: document.querySelector('#list-summary'),
  pagination: document.querySelector('#pagination'),
  search: document.querySelector('#search-input'),
  availability: document.querySelector('#availability-filter'),
  loanFilter: document.querySelector('#loan-filter'),
  primaryAction: document.querySelector('#primary-action'),
  viewTitle: document.querySelector('#view-title'),
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

async function api(path, options) {
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message ?? `Request failed (${response.status}).`);
  return payload;
}

function toast(message) {
  const node = document.querySelector('#toast');
  node.textContent = message;
  node.classList.add('is-visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => node.classList.remove('is-visible'), 2800);
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
}

function localDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function updateOverview() {
  const titles = state.books.length;
  const available = state.books.reduce((sum, book) => sum + book.availableCopies, 0);
  document.querySelector('#stat-titles').textContent = titles;
  document.querySelector('#stat-available').textContent = available;
  document.querySelector('#stat-loans').textContent = state.activeLoans.length;
  document.querySelector('#tab-book-count').textContent = titles;
  document.querySelector('#tab-patron-count').textContent = state.patrons.length;
  document.querySelector('#tab-loan-count').textContent = state.activeLoans.length;
  document.querySelector('#pulse-note').textContent = state.activeLoans.length
    ? 'A few good stories are out roaming.'
    : 'Every book has a next chapter.';
}

async function fetchAll(path) {
  const items = [];
  let offset = 0;
  while (true) {
    const page = await api(`${path}${path.includes('?') ? '&' : '?'}limit=100&offset=${offset}`);
    items.push(...page.items);
    if (page.items.length < 100) return items;
    offset += 100;
  }
}

async function refreshOverview() {
  const [books, patrons, activeLoans] = await Promise.all([
    fetchAll('/api/books'),
    fetchAll('/api/patrons'),
    fetchAll('/api/loans?status=active'),
  ]);
  state.books = books;
  state.patrons = patrons;
  state.activeLoans = activeLoans;
  updateOverview();
}

function emptyState({ title, message, action, icon = 'book' }) {
  const iconMarkup = icon === 'reader'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="8" r="3.5"/><path d="M3.5 20c.5-3.8 2.7-5.7 6.5-5.7s6 1.9 6.5 5.7M17 5.5a3.4 3.4 0 0 1 0 6.5m1.3 1.5c1.5.5 2.4 1.7 2.7 3.7"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 5.5c3.2-1 6-.5 8.5 1.7v12.4c-2.5-2.2-5.3-2.7-8.5-1.7V5.5Zm17 0c-3.2-1-6-.5-8.5 1.7v12.4c2.5-2.2 5.3-2.7 8.5-1.7V5.5Z"/></svg>';
  return `<div class="empty-state"><div class="empty-mark">${iconMarkup}</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p>${action ?? ''}</div>`;
}

function paginationMarkup(offset, count) {
  const previousDisabled = offset === 0 ? 'disabled' : '';
  const nextDisabled = count < pageSize ? 'disabled' : '';
  return `<button class="page-button" data-page="previous" aria-label="Previous page" ${previousDisabled}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10 3-5 5 5 5"/></svg></button><span class="page-number">${Math.floor(offset / pageSize) + 1}</span><button class="page-button" data-page="next" aria-label="Next page" ${nextDisabled}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5"/></svg></button>`;
}

function bookMarkup(book, index) {
  const out = book.availableCopies === 0;
  const cover = covers[index % covers.length];
  const details = [book.publicationYear, book.isbn].filter(Boolean).map(escapeHtml);
  const detailText = details.length ? details.join('<br>') : '<span class="mono">No edition details</span>';
  return `<div class="book-row book-grid">
    <div class="book-cell"><div class="book-cover" style="background:${cover}"><span>${escapeHtml(initials(book.title).slice(0, 1))}</span></div><div class="book-text"><div class="book-title">${escapeHtml(book.title)}</div><div class="book-author">${escapeHtml(book.author)}</div></div></div>
    <div class="detail-cell">${detailText}</div>
    <div><span class="stock${out ? ' is-out' : ''}">${out ? 'All borrowed' : `${book.availableCopies} of ${book.totalCopies} ready`}</span></div>
    <button class="button button-small row-action" data-checkout-book="${book.id}" ${out ? 'disabled title="No copies are currently available"' : ''}>Check out</button>
  </div>`;
}

function patronMarkup(patron) {
  return `<div class="patron-row patron-grid">
    <div class="book-cell"><span class="reader-avatar">${escapeHtml(initials(patron.name))}</span><div><div class="reader-name">${escapeHtml(patron.name)}</div><div class="reader-email">${escapeHtml(patron.email)}</div></div></div>
    <div class="reader-email">Joined ${new Date(patron.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</div>
    <span class="reader-created"></span>
  </div>`;
}

function loanMarkup(loan) {
  const isReturned = Boolean(loan.returnedAt);
  const isOverdue = !isReturned && loan.dueDate < localDateString(new Date());
  const due = isReturned ? `Returned ${new Date(loan.returnedAt).toLocaleDateString()}` : `Due ${loan.dueDate}`;
  return `<div class="loan-row loan-grid">
    <div><div class="loan-book">${escapeHtml(loan.book.title)}</div><div class="loan-person">${escapeHtml(loan.patron.name)} · ${escapeHtml(loan.book.author)}</div></div>
    <div class="due-date${isOverdue ? ' is-overdue' : ''}">${escapeHtml(due)}</div>
    <span class="loan-status"><span class="status-tag${isReturned ? ' is-returned' : ''}">${isReturned ? 'Back on shelf' : isOverdue ? 'Overdue' : 'Out exploring'}</span></span>
    ${isReturned ? '<span></span>' : `<button class="button button-small row-action" data-return-loan="${loan.id}">Mark returned</button>`}
  </div>`;
}

function setTableHeader(kind) {
  if (kind === 'books') return '<div class="column-head book-grid"><span>Book</span><span class="col-details">Edition</span><span>Availability</span><span></span></div>';
  if (kind === 'patrons') return '<div class="column-head patron-grid"><span>Reader</span><span>Email / joined</span><span class="col-created"></span></div>';
  return '<div class="column-head loan-grid"><span>Book &amp; reader</span><span class="col-due">Due date</span><span class="col-status">Status</span><span></span></div>';
}

function setSummary(message, right = '') {
  elements.summary.textContent = message;
  document.querySelector('#list-meta-right').textContent = right;
}

async function renderCurrent() {
  const offset = state.offsets[state.view];
  elements.collection.setAttribute('aria-busy', 'true');
  elements.collection.innerHTML = '';
  elements.pagination.innerHTML = '';

  try {
    if (state.view === 'books') {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
      if (state.query) params.set('q', state.query);
      if (elements.availability.value !== 'all') params.set('available', elements.availability.value);
      const page = await api(`/api/books?${params}`);
      const rows = page.items;
      setSummary(`${rows.length ? `${offset + 1}–${offset + rows.length}` : '0'} titles on this page`, state.query ? `Results for “${state.query}”` : 'All titles');
      elements.collection.innerHTML = `${setTableHeader('books')}${rows.length
        ? rows.map(bookMarkup).join('')
        : emptyState({ title: state.query ? 'No matches on this shelf.' : 'This shelf is waiting for a story.', message: state.query ? 'Try another title, author, or ISBN.' : 'Start the collection with a book worth passing along.', action: `<button class="button button-primary" data-empty-action="book">Add a book</button>` })}`;
      if (rows.length) elements.pagination.innerHTML = paginationMarkup(offset, rows.length);
    } else if (state.view === 'patrons') {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
      if (state.query) params.set('q', state.query);
      const page = await api(`/api/patrons?${params}`);
      const rows = page.items;
      setSummary(`${rows.length ? `${offset + 1}–${offset + rows.length}` : '0'} readers on this page`, state.query ? `Results for “${state.query}”` : 'Library members');
      elements.collection.innerHTML = `${setTableHeader('patrons')}${rows.length
        ? rows.map(patronMarkup).join('')
        : emptyState({ title: state.query ? 'No readers found.' : 'The reader list is a blank page.', message: state.query ? 'Try a different name or email.' : 'Every great library starts with its readers.', icon: 'reader', action: '<button class="button button-primary" data-empty-action="patron">Add a reader</button>' })}`;
      if (rows.length) elements.pagination.innerHTML = paginationMarkup(offset, rows.length);
    } else {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
      if (elements.loanFilter.value !== 'all') params.set('status', elements.loanFilter.value);
      const page = await api(`/api/loans?${params}`);
      const rows = page.items;
      setSummary(`${rows.length ? `${offset + 1}–${offset + rows.length}` : '0'} loans on this page`, elements.loanFilter.options[elements.loanFilter.selectedIndex].text);
      elements.collection.innerHTML = `${setTableHeader('loans')}${rows.length
        ? rows.map(loanMarkup).join('')
        : emptyState({ title: elements.loanFilter.value === 'returned' ? 'No books have made it back yet.' : 'No books are out exploring.', message: 'The next great read is still waiting on the shelf.', action: '<button class="button button-primary" data-empty-action="loan">Check out a book</button>' })}`;
      if (rows.length) elements.pagination.innerHTML = paginationMarkup(offset, rows.length);
    }
    elements.collection.setAttribute('aria-busy', 'false');
  } catch (error) {
    setSummary('The shelves could not load.');
    elements.collection.innerHTML = emptyState({ title: 'A little quiet in here.', message: error.message, action: '<button class="button button-primary" data-retry>Try again</button>' });
    elements.collection.setAttribute('aria-busy', 'false');
  }
}

function updateView() {
  document.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.dataset.view === state.view;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  const isBooks = state.view === 'books';
  const isPatrons = state.view === 'patrons';
  elements.viewTitle.textContent = isBooks ? 'The shelves' : isPatrons ? 'The readers' : 'Out in the world';
  elements.primaryAction.querySelector('span').textContent = isBooks ? 'Add a book' : isPatrons ? 'Add a reader' : 'Check out a book';
  document.querySelector('#search-wrap').classList.toggle('is-hidden', state.view === 'loans');
  document.querySelector('#availability-wrap').classList.toggle('is-hidden', !isBooks);
  document.querySelector('#loan-filter-wrap').classList.toggle('is-hidden', state.view !== 'loans');
  document.querySelector('#search-label').textContent = isBooks ? 'Search titles' : 'Search readers';
  elements.search.placeholder = isBooks ? 'Find a title or author' : 'Find a reader';
  renderCurrent();
}

async function openLoanDialog(bookId = null) {
  try {
    await refreshOverview();
    const availableBooks = state.books.filter((book) => book.availableCopies > 0);
    if (!availableBooks.length) throw new Error('There are no available books to check out right now.');
    if (!state.patrons.length) throw new Error('Add a reader before checking out a book.');
    const bookSelect = document.querySelector('#loan-book-select');
    const patronSelect = document.querySelector('#loan-patron-select');
    bookSelect.innerHTML = availableBooks.map((book) => `<option value="${book.id}">${escapeHtml(book.title)} · ${book.availableCopies} ready</option>`).join('');
    patronSelect.innerHTML = state.patrons.map((patron) => `<option value="${patron.id}">${escapeHtml(patron.name)}</option>`).join('');
    if (bookId !== null) bookSelect.value = String(bookId);
    const due = new Date();
    due.setDate(due.getDate() + 14);
    document.querySelector('#loan-due-date').min = localDateString(new Date());
    document.querySelector('#loan-due-date').value = localDateString(due);
    document.querySelector('#loan-error').textContent = '';
    document.querySelector('#loan-dialog').showModal();
  } catch (error) {
    toast(error.message);
  }
}

function openDialog(id) {
  const dialog = document.querySelector(`#${id}`);
  const form = dialog.querySelector('form');
  form.reset();
  dialog.querySelector('.form-error').textContent = '';
  if (id === 'book-dialog') form.elements.totalCopies.value = '1';
  dialog.showModal();
}

function postOptions(body) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

async function submitForm(form, path, body, dialogId, successMessage) {
  const errorNode = document.querySelector(`#${dialogId} .form-error`);
  errorNode.textContent = '';
  try {
    await api(path, postOptions(body));
    document.querySelector(`#${dialogId}`).close();
    toast(successMessage);
    await refreshOverview();
    await renderCurrent();
  } catch (error) {
    errorNode.textContent = error.message;
  }
}

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
  state.view = tab.dataset.view;
  state.offsets[state.view] = 0;
  updateView();
}));

elements.primaryAction.addEventListener('click', () => {
  if (state.view === 'books') openDialog('book-dialog');
  else if (state.view === 'patrons') openDialog('patron-dialog');
  else openLoanDialog();
});

let searchTimer;
elements.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = elements.search.value.trim();
    state.offsets[state.view] = 0;
    renderCurrent();
  }, 180);
});

elements.availability.addEventListener('change', () => {
  state.offsets.books = 0;
  renderCurrent();
});
elements.loanFilter.addEventListener('change', () => {
  state.offsets.loans = 0;
  renderCurrent();
});

elements.pagination.addEventListener('click', (event) => {
  const button = event.target.closest('[data-page]');
  if (!button || button.disabled) return;
  state.offsets[state.view] = Math.max(0, state.offsets[state.view] + (button.dataset.page === 'next' ? pageSize : -pageSize));
  renderCurrent();
});

elements.collection.addEventListener('click', async (event) => {
  const checkout = event.target.closest('[data-checkout-book]');
  if (checkout) return openLoanDialog(Number(checkout.dataset.checkoutBook));
  const returnButton = event.target.closest('[data-return-loan]');
  if (returnButton) {
    returnButton.disabled = true;
    try {
      await api(`/api/loans/${returnButton.dataset.returnLoan}/return`, postOptions({}));
      toast('Back on the shelf.');
      await refreshOverview();
      await renderCurrent();
    } catch (error) {
      returnButton.disabled = false;
      toast(error.message);
    }
  }
  const emptyAction = event.target.closest('[data-empty-action]');
  if (emptyAction) {
    if (emptyAction.dataset.emptyAction === 'book') openDialog('book-dialog');
    else if (emptyAction.dataset.emptyAction === 'patron') openDialog('patron-dialog');
    else openLoanDialog();
  }
  if (event.target.closest('[data-retry]')) initialize();
});

document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => {
  document.querySelector(`#${button.dataset.close}`).close();
}));

document.querySelector('#book-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const year = data.get('publicationYear');
  await submitForm(event.currentTarget, '/api/books', {
    title: data.get('title'),
    author: data.get('author'),
    isbn: data.get('isbn') || null,
    publicationYear: year ? Number(year) : null,
    totalCopies: Number(data.get('totalCopies')),
  }, 'book-dialog', 'Added to the shelves.');
});

document.querySelector('#patron-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  await submitForm(event.currentTarget, '/api/patrons', {
    name: data.get('name'), email: data.get('email'),
  }, 'patron-dialog', 'A new reader has joined.');
});

document.querySelector('#loan-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  await submitForm(event.currentTarget, '/api/loans', {
    bookId: Number(data.get('bookId')),
    patronId: Number(data.get('patronId')),
    dueDate: data.get('dueDate'),
  }, 'loan-dialog', 'Off on a new adventure.');
});

async function initialize() {
  elements.collection.setAttribute('aria-busy', 'true');
  setSummary('Loading the shelves…');
  try {
    await refreshOverview();
    await renderCurrent();
  } catch (error) {
    setSummary('The shelves could not load.');
    elements.collection.innerHTML = emptyState({ title: 'A little quiet in here.', message: error.message, action: '<button class="button button-primary" data-retry>Try again</button>' });
    elements.collection.setAttribute('aria-busy', 'false');
  }
}

const today = new Date();
document.querySelector('#today-label').textContent = today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
document.querySelector('#footer-year').textContent = String(today.getFullYear());
initialize();