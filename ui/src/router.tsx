import { createBrowserHistory, parseHref } from '@tanstack/history';
import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

const history = createBrowserHistory({
  parseLocation: () => {
    const hash = window.location.hash.replace(/^#/, '') || 'overview';
    const pathname = hash === 'overview' ? '/' : `/${hash}`;
    return parseHref(`${pathname}${window.location.search}`, window.history.state);
  },
  createHref: (href) => {
    const route = href === '/' ? 'overview' : href.replace(/^\/+/, '');
    return `${window.location.pathname}${window.location.search}#${route}`;
  },
});

export const router = createRouter({
  routeTree,
  history,
  scrollRestoration: false,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
