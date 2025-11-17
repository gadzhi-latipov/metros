import { createHashRouter } from '@vkontakte/vk-mini-apps-router/dist/index.js';

export const router = createHashRouter([
  {
    path: '/',
    panel: 'home',
    view: 'default'
  }
]);

export const DEFAULT_VIEW_PANELS = {
  HOME: 'home'
};