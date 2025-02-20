FROM node:22.14.0-slim

RUN apt-get -y update \
    && apt-get install -y curl \
    && mkdir -p /home/node/.npm /home/node/app \
    && chown -R node:node /home

WORKDIR /home/node/app

USER node

CMD [ "npm", "start" ]
