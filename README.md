# Bingo en sala

Bingo de 90 bolas para jugar con un bingo físico: las bolas se cantan en la mesa y cada jugador tiene su cartón en el celular.

## Cómo funciona

1. Alguien crea una sala con su nombre y recibe un código de 4 letras.
2. Los demás entran con ese código (o con el enlace del botón **Invitar**). Cada jugador recibe 1 cartón al entrar.
3. Cada uno toca los números de su cartón para marcarlos.
4. El botón grande dice **¡LÍNEA!**. Cuando alguien lo aprieta, toda la sala ve el aviso y el botón pasa a **¡BINGO!**.
5. Quien creó la sala puede **anular el último canto** (si fue un error) o empezar una **nueva partida** con cartones nuevos para todos.

Los cartones siguen las reglas del bingo de 90: 3 filas x 9 columnas, 15 números, 5 por fila, y cada columna agrupa su decena (1-9, 10-19, ..., 80-90).

## Correrlo

Solo necesitas Node.js 18 o superior. No hay dependencias que instalar.

```bash
npm start        # abre http://localhost:3000
npm test         # valida la generación de cartones
```

Para jugar en la misma red WiFi, los demás entran a `http://<IP-de-tu-computador>:3000`.

## Notas

- Las salas viven en memoria: si el servidor se reinicia, se pierden. Una sala sin actividad se borra a las 12 horas.
- Las marcas del cartón se guardan en el celular de cada jugador, así que sobreviven a una recarga de la página.
- Para publicarlo en internet necesitas un hosting que mantenga el servidor encendido (Render, Railway, Fly.io). Vercel no sirve tal cual porque no mantiene conexiones abiertas ni memoria entre peticiones.
