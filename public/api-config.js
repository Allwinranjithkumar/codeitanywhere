/**
 * api-config.js — Universal API Routing & Backend URL resolver
 *
 * Supports two seamless deployment architectures:
 * 1. Vercel Rewrites Proxy (Default):
 *    All /api/* calls stay relative. Vercel handles reverse proxying to Render/Railway.
 *    Result: Zero CORS issues, automatic SSL matching, no domain switching needed.
 *
 * 2. Direct Cross-Origin Connection:
 *    Set window.__API_BASE__ or localStorage.setItem('API_BASE_URL', 'https://your-backend.onrender.com')
 *    All /api/* calls automatically prefix the configured remote backend URL.
 */
(function() {
    // 1. Detect configured remote backend if any
    var customBase = '';
    try {
        customBase = localStorage.getItem('API_BASE_URL') || (window.__API_BASE__ || '');
    } catch (_) {}

    // Clean trailing slashes
    if (customBase) {
        customBase = customBase.replace(/\/+$/, '');
    }

    window.API_BASE_URL = customBase;

    // 2. Intercept window.fetch for /api endpoints if a custom base URL is specified
    if (customBase) {
        var originalFetch = window.fetch;
        window.fetch = function(resource, init) {
            if (typeof resource === 'string' && resource.startsWith('/api/')) {
                resource = customBase + resource;
            } else if (resource instanceof Request && resource.url.startsWith('/api/')) {
                resource = new Request(customBase + resource.url, resource);
            }
            return originalFetch.call(this, resource, init);
        };
    }
})();
