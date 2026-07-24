const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateClientSessionId() {
  let value = '';

  for (let index = 0; index < 3; index += 1) {
    const randomIndex = Math.floor(Math.random() * alphabet.length);
    value += alphabet[randomIndex];
  }

  return value;
}
