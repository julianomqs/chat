FROM node:24-alpine
WORKDIR /app
RUN chown node:node /app
USER node
EXPOSE 5173
CMD ["npm", "start"]
