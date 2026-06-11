#!/usr/bin/env sh
set -eu

IMAGE_NAME="alcheradev/ais.camera-test:fe"
PLATFORM="linux/amd64"

docker build \
  --platform "$PLATFORM" \
  --tag "$IMAGE_NAME" \
  .

echo "Built Docker image: $IMAGE_NAME ($PLATFORM)"
