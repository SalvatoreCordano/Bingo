const test = require('node:test');
const assert = require('node:assert');
const { scoreRound } = require('../lib/game');

test('puntaje del Tutti Frutti: 20 único, 10 distinta, 5 repetida, 0 inválida', () => {
  const players = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const answers = {
    a: ['Ana', 'Anana', 'Ámsterdam', '', 'Árbol', '', ''],
    b: ['ana', 'Arándano', 'amsterdam', 'Bus', '', ' ', ''],
    c: ['Andrés', '', 'Asunción', 'Atasco', '', '', 'Aquaman'],
  };
  const r = scoreRound('A', players, answers, { 'c:0': true });
  assert.deepStrictEqual(r.a.points, [5, 10, 5, 0, 20, 0, 0, 0]);
  assert.deepStrictEqual(r.b.points, [5, 10, 5, 0, 0, 0, 0, 0]);
  assert.deepStrictEqual(r.c.points, [0, 0, 10, 20, 0, 0, 20, 0]);
  assert.strictEqual(r.b.status[3], 'letra');
  assert.strictEqual(r.c.status[0], 'anulada');
  assert.deepStrictEqual([r.a.total, r.b.total, r.c.total], [40, 20, 50]);
});
