FROM node:20.18.0-alpine

COPY package.json .
COPY manifests ./manifests
COPY src ./src

RUN npm i

CMD ["node", "src/api.js"]