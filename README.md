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

Las respuestas se escriben en papel; la app pone la letra y el orden.

1. Quien creó la sala gira la **ruleta**. Todos ven la misma animación y la misma letra al mismo tiempo.
2. La ruleta no repite letras. Deja fuera las difíciles (K, Ñ, Q, W, X, Y, Z).
3. Cualquier jugador puede apretar **¡BASTA!** para cortar la ronda, y a todos les aparece el aviso con su nombre.
4. Quien creó la sala puede **devolver todas las letras** a la ruleta para empezar de cero.

Categorías (fijas, en `CATEGORIES` dentro de `server.js`): Nombre, Fruta o verdura, Ciudad o país, Excusa para llegar tarde, Algo que llevarías a una isla desierta, Algo que se encuentra en una cartera y Superhéroe.

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
