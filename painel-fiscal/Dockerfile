FROM node:24-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public
RUN mkdir /data && chown node:node /data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4273 DATA_DIR=/data COOKIE_SECURE=true
USER node
EXPOSE 4273
CMD ["node", "server.mjs"]
