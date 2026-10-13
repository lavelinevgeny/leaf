import { expect, it } from 'vitest';
import { placeMenu } from '../../src/client/menu-position.js';

const size = { width: 200, height: 120 };
const desktop = { width: 1440, height: 900 };
const box = (top: number, right: number) => ({
  top,
  bottom: top + 26,
  left: right - 26,
  right,
});

it('places the menu below the trigger, right-aligned', () => {
  expect(placeMenu(box(100, 326), size, desktop)).toEqual({
    top: 130,
    left: 126,
    side: 'below',
  });
});

it('flips above when there is no room below', () => {
  expect(placeMenu(box(850, 326), size, desktop)).toEqual({
    top: 726,
    left: 126,
    side: 'above',
  });
});

it('clamps horizontally inside an 8px viewport margin', () => {
  expect(placeMenu(box(100, 50), size, desktop).left).toBe(8);
  expect(placeMenu(box(100, 1500), size, desktop).left).toBe(1232);
});

it('keeps the menu in a short viewport when neither side fits', () => {
  expect(
    placeMenu(
      box(60, 326),
      { width: 200, height: 180 },
      {
        width: 1440,
        height: 200,
      },
    ),
  ).toEqual({ top: 12, left: 126, side: 'below' });
});

it('fits a 240px menu on a 375px phone viewport', () => {
  expect(
    placeMenu(
      box(300, 360),
      { width: 240, height: 120 },
      {
        width: 375,
        height: 812,
      },
    ).left,
  ).toBe(120);
});

it('fits a 200% zoom viewport of 720x450 CSS px', () => {
  expect(placeMenu(box(300, 700), size, { width: 720, height: 450 })).toEqual({
    top: 176,
    left: 500,
    side: 'above',
  });
});
