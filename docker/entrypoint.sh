#!/bin/sh

echo "🏗️   Iniciando a montagem do seu Container de Node.JS..."

cd /app && yarn install

echo "🚀   Deploy completed! The application is updated."

# Manter o container ativo
exec "$@"
