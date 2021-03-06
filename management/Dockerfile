FROM node:6.9.2

MAINTAINER Zhang Wenqing "winking.zhang@grapecity.com"

ENV CODESPARK_SERVICE_VERSION 1.0~node6.9.2

WORKDIR /codespark/management
VOLUME /codespark/management/conf
VOLUME /codespark/management/data
VOLUME /codespark/management/logs
COPY ./common /codespark/common
COPY ./management /codespark/management

# Install basic requirements and clean up cache folders
RUN apt-get update -qq \
    && apt-get install -y apt-utils build-essential \
    && cd /codespark/common \
    && npm install --production \
    && cd /codespark/management \
    && npm install --production \
    && npm cache clean \
    && apt-get remove -y apt-utils build-essential \
    && apt-get autoremove -y \
    && rm -rf /tmp \
    && rm -rf ~/.cache \
    && rm -rf ~/.node-gyp \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV production
EXPOSE 8000
CMD [ "node", "app.js" ]