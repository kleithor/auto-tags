FROM node:14-alpine as builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:14-alpine as app
COPY package.json package-lock.json /auto-tags/
RUN cd /auto-tags && npm install

COPY --from=builder /app/lib /auto-tags/lib/
RUN chmod +x /auto-tags/lib/src/main.js

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]