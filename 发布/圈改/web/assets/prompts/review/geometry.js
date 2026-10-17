export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function rectangleBetween(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(start.x - end.x),
    height: Math.abs(start.y - end.y),
  };
}

export function pixelRectangle(rect, image) {
  const x = Math.floor(clamp(rect.x) * image.width);
  const y = Math.floor(clamp(rect.y) * image.height);
  const right = Math.min(image.width, Math.ceil((rect.x + rect.width) * image.width));
  const bottom = Math.min(image.height, Math.ceil((rect.y + rect.height) * image.height));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

export function translateRectangle(rect, offset) {
  return { ...rect, x: clamp(rect.x + offset.x, 0, 1 - rect.width), y: clamp(rect.y + offset.y, 0, 1 - rect.height) };
}

export function canCompare(images) {
  const { original, revised } = images;
  return Boolean(original && revised && original.width === revised.width && original.height === revised.height);
}
