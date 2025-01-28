#!/bin/sh

echo "🏗️   Starting the setup of your Node.JS Container..."

cd /app && yarn install

echo "🚀   Deploy completed! The application is updated."

exec "$@"
