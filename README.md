# Cloud Kitchen Backend

This is a Node.js + Express backend for a cloud kitchen R&D management system. It allows chefs to create cooking experiments, reviewers to evaluate them using sensory scoring, and managers to analyze performance with AI insights.

The backend uses PostgreSQL with Prisma ORM for database management and follows a service-based architecture (controllers → services → DB).

Authentication is handled using JWT with role-based access control (Chef, Reviewer, Manager, CRA). Passwords are securely hashed using bcrypt.

File uploads (experiment images) are managed via Multer and stored on Cloudinary.

AI-powered analysis is integrated using Groq API for recipe insights and reports.

PDF reports are generated using PDFKit and stored in the `/reports` directory.

Validation is implemented using Joi, and global error handling ensures consistent API responses.

The project follows modular routing and middleware structure for scalability and maintainability.

Run the server using:
```bash
npm run dev