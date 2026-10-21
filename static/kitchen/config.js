// Public settings only. Never put Apps Script URLs, sheet IDs, or secrets here.
export const config = Object.freeze({
  apiPath: '/api/kitchen',
  turnstileSiteKey: '0x4AAAAAAFflgeIiuQBXsKPw', // Public Turnstile sitekey; its secret belongs in the Worker.
});
