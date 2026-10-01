# Juegos en sala

Bingo y Tutti Frutti para jugar en grupo, cada uno desde su celular. Al crear la sala eliges el juego; quienes entran con el código llegan directo a ese juego.

## Bingo

Bingo de 90 bolas para jugar con un bingo físico: las bolas se cantan en la mesa y cada jugador tiene su cartón en el celular.

1. Alguien crea una sala con su nombre y recibe un código de 4 letras.
2. Los demás entran con ese código (o con el enlace del botón **Invitar**). Cada jugador recibe 1 cartón al entrar.
3. Cada uno toca los números de su cartón para marcarlos.
4. El botón grande dice **¡LÍNEA!**. Cuando alguien lo aprieta, toda la sala ve el aviso y el botón pasa a **¡BINGO!**.
5. Quien creó la sala puede **anular el último canto** (si fue un error) o empezar una **nueva partida** con cartones nuevos para todos.

Los cartones siguen las reglas del bingo de 90: 3 filas x 9 columnas, 15 números, 5 por fila, y cada columna agrupa su decena (1-9, 10-19, ..., 80-90).

## Tutti Frutti

Todo se juega en la web, cada uno desde su celular.

1. Quien creó la sala gira la **ruleta**. Todos ven la misma animación y la misma letra al mismo tiempo. La ruleta no repite letras y deja fuera las difíciles (K, Ñ, Q, W, X, Y, Z).
2. Cada jugador escribe sus respuestas. Se guardan solas mientras escribe (también si recarga la página).
3. **¡BASTA!** se activa cuando completaste todas las categorías. El anfitrión puede cortar la ronda aunque le falten.
4. Tras el basta hay 3 segundos de gracia para que lleguen las últimas respuestas y se bloquea la escritura.
5. **Revisión**: todos ven las respuestas de todos. El anfitrión puede anular las que no valen y luego confirma los puntos.
6. Los puntos se acumulan en la **tabla**. "Nueva partida" pone los puntos a cero y devuelve las letras.

**Puntaje:** 20 si eres el único con respuesta válida en la categoría, 10 si tu respuesta es distinta, 5 si se repite, 0 si está vacía, no empieza con la letra o fue anulada. No importan tildes ni mayúsculas.

Categorías (fijas, en `CATEGORIES` dentro de `lib/game.js`): Nombre, Fruta o verdura, Ciudad o país, Excusa para llegar tarde, Algo que llevarías a una isla desierta, Algo que se encuentra en una cartera, Superhéroe y Apodo o chapa.

## Correrlo en tu computador

Solo necesitas Node.js 18 o superior. No hay dependencias que instalar.

```bash
npm start        # abre http://localhost:3000 (salas en memoria)
npm test         # valida la generación de cartones
```

Para jugar en la misma red WiFi, los demás entran a `http://<IP-de-tu-computador>:3000`.

## Publicado en Vercel

- `api/handler.js` es la función que atiende todo `/api/*` (ver `vercel.json`); `public/` se sirve como sitio estático.
- Las salas se guardan en **Upstash Redis**. La conexión se toma de las variables `KV_REST_API_URL` y `KV_REST_API_TOKEN` (o `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`), que Vercel agrega al conectar la base al proyecto.
- Cada celular consulta la sala cada ~1,2 s y deja de hacerlo cuando la app queda en segundo plano.
- Un bloqueo corto por sala asegura que, si dos personas cantan a la vez, gane solo la primera.

## Estructura

- `lib/game.js`: reglas de los juegos, cartones y acciones de la sala.
- `lib/store.js`: dónde se guardan las salas (memoria o Redis).
- `local-server.js`: servidor para jugar en local.
- `api/handler.js`: función de Vercel.
- `public/`: la app que ven los jugadores.

Las salas sin actividad se borran a las 12 horas.
