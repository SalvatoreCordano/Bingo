const test = require('node:test');
const assert = require('node:assert');
const { generateCard } = require('../server');

test('los cartones cumplen las reglas del bingo de 90', () => {
  for (let i = 0; i < 2000; i++) {
    const card = generateCard();
    assert.strictEqual(card.length, 3);
    const all = card.flat().filter((n) => n !== null);
    assert.strictEqual(all.length, 15, '15 números');
    assert.strictEqual(new Set(all).size, 15, 'sin repetidos');
    card.forEach((row) => assert.strictEqual(row.filter((n) => n !== null).length, 5, '5 por fila'));
    for (let col = 0; col < 9; col++) {
      const nums = card.map((row) => row[col]).filter((n) => n !== null);
      assert.ok(nums.length >= 1 && nums.length <= 3, '1 a 3 por columna');
      const min = col === 0 ? 1 : col * 10;
      const max = col === 8 ? 90 : col * 10 + 9;
      nums.forEach((n) => assert.ok(n >= min && n <= max, `rango de columna ${col}`));
      assert.deepStrictEqual(nums, [...nums].sort((a, b) => a - b), 'orden ascendente');
    }
  }
});
