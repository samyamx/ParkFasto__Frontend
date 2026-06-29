# Parko Frontend

## Project Overview
Parko is a smart parking management system designed to make parking hassle-free for drivers and parking lot owners.  
The frontend is responsible for providing a seamless user interface where users can:

- Find and book parking spots
- View real-time availability
- Manage their profiles and reservations
- Receive notifications or updates

This frontend is built to interact with the backend API for all data operations.

---

## Tech Stack

- **Framework:** React (with Vite for fast development and build)
- **State Management:** Redux Toolkit / React Context (if used)
- **Styling:** Tailwind CSS + custom CSS
- **Routing:** React Router DOM
- **HTTP Requests:** Axios
- **Authentication:** JWT-based token handling
- **Deployment:** Vercel



---

## How It Works

1. User interacts with UI components on the frontend.
2. Frontend sends HTTP requests to the backend API for data.
3. Backend responds with JSON, which frontend renders.
4. JWT tokens are used to authenticate users and protect routes.
5. Real-time updates can be fetched periodically or using web sockets (if implemented).

---