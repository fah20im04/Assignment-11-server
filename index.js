// =========================
//  BACKEND SERVER
// =========================

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// =========================
//  FIREBASE ADMIN INIT
// =========================
const serviceAccount = require("./civicconnet-firebase-adminsdk-fbsvc-9c71a80474.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

console.log(" Firebase Admin Initialized");

// =========================
//  GLOBAL MIDDLEWARES
// =========================
app.use(express.json());

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// =========================
//  VERIFY FIREBASE TOKEN
// =========================
const verifyFbToken = async (req, res, next) => {
  console.log(" Incoming headers:", req.headers);

  const authHeader = req.headers.authorization;

  if (!authHeader) {
    console.log(" No Authorization header found");
    return res.status(401).send({ message: "Unauthorized: No token" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    console.log(" Token verified:", decoded.email);

    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    console.log(" Token verify failed:", error.message);
    return res.status(401).send({ message: "Unauthorized: Invalid token" });
  }
};

// =========================
//  MONGODB INIT
// =========================
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.qvklz1c.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// =========================
//  MAIN FUNCTION
// =========================
async function run() {
  try {
    await client.connect();
    console.log(" Connected to MongoDB");

    //=======================
    //Collections
    //=======================

    const db = client.db("public_Infrastructure_user");
    const usersCollection = db.collection("users");
    const issuesCollection = db.collection("issues");

    // =========================
    //  GET USERS (Protected)
    // =========================
    app.get("/users", async (req, res) => {
      const searchText = req.query.searchText;
      const query = {};

      if (searchText) {
        query.$or = [
          { displayName: { $regex: searchText, $options: "i" } },
          { email: { $regex: searchText, $options: "i" } },
        ];
      }

      const result = await usersCollection.find(query).limit(5).toArray();
      res.send(result);
    });

    // =========================
    //  CREATE USER (Unprotected)
    // =========================
    app.post("/users", async (req, res) => {
      try {
        const user = req.body;
        user.createdAt = new Date();

        const existing = await usersCollection.findOne({ email: user.email });
        if (existing) {
          return res.status(409).send({ message: "User already exists" });
        }

        const result = await usersCollection.insertOne(user);

        res.status(201).send({
          message: "User created successfully",
          insertedId: result.insertedId,
        });
      } catch (e) {
        console.error("Error inserting user:", e);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    //=========================
    //issues related api
    //=========================
    app.post("/issues", verifyFbToken, async (req, res) => {
      try {
        const issue = req.body;

        issue.createdAt = new Date();
        issue.status = "Pending";
        issue.priority = "Normal";
        issue.upvotes = 0;

        // Attach the user's email
        issue.userEmail = req.decoded_email;

        const result = await issuesCollection.insertOne(issue);

        res.status(201).send({
          message: "Issue created successfully",
          insertedId: result.insertedId,
        });
      } catch (e) {
        console.error("Error inserting issue:", e);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.get("/issues", async (req, res) => {
      try {
        const issues = await issuesCollection.find().toArray();
        res.send(issues);
      } catch (e) {
        console.error("Error fetching issues:", e);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // my issue related api

    app.get("/issues/my-issues/:email", async (req, res) => {
      try {
        const email = req.params.email;

        const issues = await issuesCollection
          .find({ userEmail: email })
          .sort({ createdAt: -1 })
          .toArray();

        res.status(200).send(issues);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.get("/issues/:id", async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid issue ID" });
        }

        const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });

        if (!issue) {
          return res.status(404).send({ message: "Issue not found" });
        }

        res.send(issue);
      } catch (err) {
        console.error("Error fetching issue:", err);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // PATCH /issues/update/:id
    // app.patch("/issues/update/:id", async (req, res) => {
    //   try {
    //     const id = req.params.id;
    //     const updates = req.body;

    //     // Get existing issue
    //     const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });

    //     if (!issue) return res.status(404).send({ message: "Issue not found" });

    //     if (issue.status !== "Pending")
    //       return res
    //         .status(400)
    //         .send({ message: "Only pending issues can be edited" });

    //     // Update allowed fields
    //     const updatedIssue = await issuesCollection.updateOne(
    //       { _id: new ObjectId(id) },
    //       { $set: updates }
    //     );

    //     res.status(200).send({ message: "Issue updated successfully" });
    //   } catch (err) {
    //     console.error(err);
    //     res.status(500).send({ message: "Internal server error" });
    //   }
    // });

    // DELETE /issues/:id
    app.delete("/issues/:id", async (req, res) => {
      try {
        const id = req.params.id;

        const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });

        if (!issue) return res.status(404).send({ message: "Issue not found" });

        if (issue.status !== "Pending")
          return res
            .status(400)
            .send({ message: "Only pending issues can be deleted" });

        await issuesCollection.deleteOne({ _id: new ObjectId(id) });

        res.status(200).send({ message: "Issue deleted successfully" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // end
  } catch (err) {
    console.error(err);
  }
}
run().catch(console.dir);

// =========================
//  BASE ROUTE
// =========================
app.get("/", (req, res) => {
  res.send(" Backend is running successfully!");
});

// =========================
//  START SERVER
// =========================
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
