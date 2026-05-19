const {
  normalizeNavigationOptions,
  isWaitForFunctionOptions,
} = require('./worker-navigation');

function patchPageForCompatibility(page) {
  if (!page || page.__compatPatched) return;
  page.__compatPatched = true;

  if (typeof page.reload === 'function') {
    const originalReload = page.reload.bind(page);
    page.reload = (options) => originalReload(normalizeNavigationOptions(options));
  }

  if (typeof page.goto === 'function') {
    const originalGoto = page.goto.bind(page);
    page.goto = (url, options) => originalGoto(url, normalizeNavigationOptions(options));
  }

  if (typeof page.waitForNavigation === 'function') {
    const originalWaitForNavigation = page.waitForNavigation.bind(page);
    page.waitForNavigation = (options) => originalWaitForNavigation(normalizeNavigationOptions(options));
  }

  if (typeof page.waitForFunction === 'function') {
    const originalWaitForFunction = page.waitForFunction.bind(page);
    page.waitForFunction = (pageFunction, argOrOptions, maybeOptions) => {
      if (maybeOptions !== undefined) {
        return originalWaitForFunction(pageFunction, argOrOptions, normalizeNavigationOptions(maybeOptions));
      }
      if (isWaitForFunctionOptions(argOrOptions)) {
        return originalWaitForFunction(pageFunction, undefined, normalizeNavigationOptions(argOrOptions));
      }
      return originalWaitForFunction(pageFunction, argOrOptions);
    };
  }

  if (typeof page.cookies !== 'function' && typeof page.context === 'function') {
    page.cookies = async (...args) => {
      const context = page.context();
      if (!context || typeof context.cookies !== 'function') return [];

      if (args.length === 0) return context.cookies();
      if (args.length === 1 && Array.isArray(args[0])) return context.cookies(args[0]);
      return context.cookies(args);
    };
  }
}

async function setCookieOnPage(page, cookie) {
  if (!cookie || !page) return;

  if (typeof page.setCookie === 'function') {
    await page.setCookie(cookie);
    return;
  }

  if (typeof page.context === 'function') {
    const context = page.context();
    if (context && typeof context.addCookies === 'function') {
      await context.addCookies([cookie]);
    }
  }
}

module.exports = {
  patchPageForCompatibility,
  setCookieOnPage,
};
