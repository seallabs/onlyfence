---
sidebar_position: 2
title: Kubernetes
description: Deploy OnlyFence on Kubernetes with native Secrets, HashiCorp Vault, AWS Secrets Manager, or sealed-secrets for production workloads.
---

# Kubernetes Deployment

OnlyFence works with any Kubernetes secret management — native Secrets, HashiCorp Vault (via Agent Injector or CSI), AWS Secrets Manager, or sealed-secrets.

## Basic Deployment

Mount the password and mnemonic as files and point the container at them:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: onlyfence
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: onlyfence
          image: ghcr.io/seallabs/onlyfence:latest
          ports:
            - containerPort: 19876
          env:
            - name: FENCE_PASSWORD_FILE
              value: /run/secrets/fence_password
          volumeMounts:
            - name: secrets
              mountPath: /run/secrets
              readOnly: true
            - name: data
              mountPath: /data
          securityContext:
            readOnlyRootFilesystem: true
            allowPrivilegeEscalation: false
            capabilities:
              drop: [ALL]
      volumes:
        - name: secrets
          secret:
            secretName: onlyfence-secrets
        - name: data
          persistentVolumeClaim:
            claimName: onlyfence-data
```

## HashiCorp Vault Integration

With the Vault Agent Injector, secrets are written to a shared tmpfs volume:

```yaml
annotations:
  vault.hashicorp.com/agent-inject: "true"
  vault.hashicorp.com/agent-inject-secret-password: "secret/data/onlyfence/password"
  vault.hashicorp.com/agent-inject-template-password: |
    {{- with secret "secret/data/onlyfence/password" -}}
    {{ .Data.data.value }}
    {{- end -}}
env:
  - name: FENCE_PASSWORD_FILE
    value: /vault/secrets/password
  - name: FENCE_MNEMONIC_FILE
    value: /vault/secrets/mnemonic
```

## Security Recommendations

- Use a **PersistentVolumeClaim** for the data directory to preserve the keystore across restarts
- Set **resource limits** to prevent runaway usage
- Use **NetworkPolicy** to restrict which pods can connect to port 19876
- Rotate secrets regularly through your secrets manager
- Monitor logs for rejected trade attempts
