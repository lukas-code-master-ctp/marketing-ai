# Imagen de desarrollo: el código se monta como volumen y se ejecuta con tsx,
# no se copia adentro. Copiarlo obligaría a reconstruir la imagen en cada
# cambio, que es exactamente la fricción que este bloque viene a quitar.
FROM node:22-alpine

# `corepack enable` falla por permisos en algunas máquinas —en la de este
# proyecto, sin ir más lejos—, así que el `||` deja la salida por npm.
RUN corepack enable pnpm || npm install -g pnpm@9

WORKDIR /app
CMD ["pnpm", "--filter", "@gc/worker", "start"]
