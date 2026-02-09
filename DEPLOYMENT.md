# Deployment Guide to Render

Since your GitHub is already connected to Render, here is how to deploy correctly to support C language execution (which requires `gcc`).

## 1. Select "Docker" Environment
**Crucial Step**: Because we need `gcc` to compile C code, you must use **Docker** instead of the standard Node.js environment.

-   **If you are creating a new Web Service**:
    -   Connect your repository.
    -   Render should automatically detect the `Dockerfile`.
    -   Ensure **Runtime** is set to **Docker**.

-   **If you already have a Web Service**:
    -   Go to **Settings**.
    -   Check if the **Runtime** is Docker.
    -   If it is "Node", you might need to create a new Web Service and select Docker, or check if "Node" supports `gcc` (it implies Native environment, which usually has basic tools, but Docker is safer).
    -   **Recommendation**: Use Docker Runtime to guarantee `gcc` availability.

## 2. Environment Variables
You must set these in the **Environment** tab of your Render service:

| Key | Value | Description |
| :--- | :--- | :--- |
| `Internal Database URL` | `postgresql://...` | **Required** for Persistent Storage. Use the Internal URL if your DB is also on Render. |
| `JWT_SECRET` | `your_secret_string` | Optional (defaults to 'your_secret_key' if unset). |
| `NODE_ENV` | `production` | Recommended. |

## 3. Verify Deployment
1.  Trigger a manual deploy if it hasn't started (via "Manual Deploy" button).
2.  Watch the logs. You should see steps like `RUN apt-get update && apt-get install -y gcc`.
3.  Once "Live", open your URL.
4.  **Important**: On the free tier, the first request might take 50 seconds to wake up.

## 4. Troubleshooting
-   **Database Error**: If you see "Partial Mode" logs, check your `DATABASE_URL`.
-   **C Code Fails**: If C code runs but fails with "command not found", then `gcc` is missing. Ensure you are using the **Docker** runtime.
