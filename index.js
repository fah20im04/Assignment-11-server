// server.js
// =========================
//  BACKEND SERVER (fixed + commented)
// =========================

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

// Stripe secret key from .env
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const app = express();
const port = process.env.PORT || 3000;

// =========================
//  FIREBASE ADMIN INIT
// =========================
// Make sure the JSON file path is correct and the file exists.
const serviceAccount = require("./civicconnet-firebase-adminsdk-fbsvc-9c71a80474.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
console.log("Firebase Admin Initialized");

// =========================
//  GLOBAL MIDDLEWARES
// =========================

const FRONTEND_ORIGIN = process.env.SITE_DOMAIN || "http://localhost:5173";

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// =========================
//  VERIFY FIREBASE TOKEN MIDDLEWARE
// =========================
const verifyFbToken = async (req, res, next) => {
  console.log("ALL HEADERS:", req.headers);

  const auth = req.headers.authorization;
  console.log("Authorization header:", auth);

  if (!auth) {
    return res.status(401).send({ message: "Unauthorized access" });
  }

  try {
    const token = auth.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: "Unauthorized token" });
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
//  MAIN (connect DB and register routes)
// =========================
async function run() {
  try {
    await client.connect();
    console.log("Connected to MongoDB");

    // ------------------------
    // Collections
    // ------------------------
    const db = client.db("public_Infrastructure_user");
    const usersCollection = db.collection("users");
    const issuesCollection = db.collection("issues");
    const paymentsCollection = db.collection("payments"); // NEW payments collection

    // ------------------------
    // Helper: addTimelineEntry
    // - Use this whenever you need to append a timeline item to an issue.
    // - Keeps timeline entry shape consistent.
    // ------------------------
    async function addTimelineEntry(issueId, entry) {
      // entry: { status, message, updatedBy, role }
      if (!ObjectId.isValid(issueId)) throw new Error("Invalid issueId");
      const timelineItem = {
        status: entry.status || null,
        message: entry.message || "",
        updatedBy: entry.updatedBy || "System",
        role: entry.role || "System", // "Admin" | "Staff" | "Citizen" | "System"
        date: new Date(),
      };

      return issuesCollection.updateOne(
        { _id: new ObjectId(issueId) },
        { $push: { timeline: timelineItem } }
      );
    }

    // ------------------------
    // ROUTES
    // ------------------------

    // BASE health check
    app.get("/", (req, res) => {
      res.send("Backend is running successfully!");
    });

    // ------------------------
    // GET USERS (protected) - returns up to 5 users, optional search
    // ------------------------
    app.get("/users", async (req, res) => {
      console.log("decoded email", req.decoded_email);
      try {
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
      } catch (err) {
        console.error("GET /users error:", err);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.get("/users/:email/role", verifyFbToken, async (req, res) => {
      try {
        const email = req.params.email;
        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).send({ role: "citizen" });
        res.send(user); // <-- You are sending the whole user object, not just { role: ... }
      } catch (err) {
        res.status(500).send({ role: "citizen" });
      }
    });

    // ------------------------
    // CREATE USER (unprotected)
    // ------------------------
    app.post("/users", async (req, res) => {
      try {
        const user = req.decoded_email;

        user.role = "citizen";
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
        console.error("POST /users error:", e);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    //===================
    // DashBoars related api
    //========================
    // GET /dashboard/citizen/:email
    app.get("/dashboard/citizen/:email", verifyFbToken, async (req, res) => {
      try {
        const email = req.decoded_email; 

        const totalIssues = await issuesCollection.countDocuments({
          userEmail: email,
        });
        const pending = await issuesCollection.countDocuments({
          userEmail: email,
          status: "Pending",
        });
        const inProgress = await issuesCollection.countDocuments({
          userEmail: email,
          status: "In-Progress",
        });
        const resolved = await issuesCollection.countDocuments({
          userEmail: email,
          status: "Resolved",
        });

        const totalPayments = await paymentsCollection
          .aggregate([
            { $match: { email } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
          ])
          .toArray();

        res.send({
          totalIssues,
          pending,
          inProgress,
          resolved,
          totalPayments: totalPayments[0]?.total || 0,
        });
      } catch (err) {
        console.error("GET /dashboard/citizen/:email error:", err);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // =========================
    // Get logged-in user's profile
    // =========================
    // =========================
    // TEMP PROFILE ROUTE (no auth, for testing)
    // =========================

    app.get("/profile", async (req, res) => {
      try {
        const email = req.query.email || "testuser@example.com";
        console.log("Fetching profile for email:", email);

        // Make query case-insensitive
        let user = await usersCollection.findOne({
          email: { $regex: `^${email}$`, $options: "i" },
        });

        if (!user) {
          console.warn(
            "User not found, creating a test user for email:",
            email
          );

          // Insert a new test user
          const newUser = {
            email,
            displayName: email.split("@")[0], // simple default display name
            photoURL:
              "https://i.pravatar.cc/150?u=" + encodeURIComponent(email),
            isPremium: false,
            isBlocked: false,
          };

          const result = await usersCollection.insertOne(newUser);
          user = newUser;

          console.log("Test user created:", user);
        } else {
          console.log("User found:", user);
        }

        res.send(user);
      } catch (err) {
        console.error("GET /profile error:", err);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // TEMP: profile route for testing
    // app.get("/profile", (req, res) => {
    //   const email = req.query.email;
    //   console.log("Profile requested for:", email);

    //   if (!email) {
    //     return res.status(400).json({ message: "Email query missing" });
    //   }

    //   // TEMP fake user object
    //   const fakeUser = {
    //     displayName: "Sazzad Ahmed",
    //     email: email,
    //     isPremium: false,
    //     isBlocked: false,
    //   };

    //   res.json(fakeUser);
    // });

    // =========================
    // Update logged-in user's profile (name, other info)
    // =========================
    app.patch("/profile", async (req, res) => {
      try {
        const email = req.body.email; // ← FIXED
        const updates = req.body;

        if (!email) {
          return res.status(400).send({ message: "Email missing" });
        }

        const result = await usersCollection.updateOne(
          { email },
          { $set: updates }
        );

        if (result.modifiedCount === 0) {
          return res.status(400).send({ message: "Nothing updated" });
        }

        const updatedUser = await usersCollection.findOne({ email });
        res.send(updatedUser);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    //-----------------------------------
    //subscription related api
    //-----------------------------------
    app.post("/subscribe", async (req, res) => {
      try {
        const email = req.body.email;
        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).send({ message: "User not found" });

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: 1000 * 100,
                product_data: { name: "Premium Subscription" },
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          customer_email: email,
          success_url: `${process.env.SITE_DOMAIN}/subscribe-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/profile`,
        });

        res.send({ url: session.url });
      } catch (err) {
        console.error("POST /subscribe error:", err);
        res.status(500).send({ message: "Subscription failed" });
      }
    });

    app.get("/subscribe-success", async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        if (!sessionId)
          return res.status(400).send({ message: "Missing session_id" });

        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const email = session.customer_email;

        // Update user as premium
        await usersCollection.updateOne(
          { email },
          { $set: { isPremium: true, subscriptionDate: new Date() } }
        );

        res.send({
          message: "Subscription successful",
          email,
          isPremium: true,
        });
      } catch (err) {
        console.error("GET /subscribe-success error:", err);
        res.status(500).send({ message: "Subscription success failed" });
      }
    });

    // ------------------------
    // CREATE ISSUE (protected)
    // - initializes timeline with "Issue reported by citizen"
    // ------------------------
    // Make sure to include the verifyFbToken middleware
    app.post("/issues", verifyFbToken, async (req, res) => {
      try {
        const issue = req.body;

        // Set default fields
        issue.createdAt = new Date();
        issue.status = "Pending";
        issue.priority = "Normal";
        issue.upvotes = 0;

        // Use decoded_email from Firebase token
        issue.userEmail = req.decoded_email;

        // Initialize timeline
        issue.timeline = [
          {
            status: "Pending",
            message: "Issue reported by citizen",
            updatedBy: req.decoded_email,
            role: "Citizen",
            date: new Date(),
          },
        ];

        console.log("Issue reporter email:", req.decoded_email);

        const result = await issuesCollection.insertOne(issue);

        res.status(201).send({
          message: "Issue created successfully",
          insertedId: result.insertedId,
        });
      } catch (e) {
        console.error("POST /issues error:", e);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // ------------------------
    // ASSIGN STAFF (protected)
    // - sets assignedTo and status; adds timeline entry
    // ------------------------
    app.post("/issues/:id/assign", async (req, res) => {
      try {
        const issueId = req.params.id;
        const { staffEmail, staffName } = req.body;

        if (!ObjectId.isValid(issueId))
          return res.status(400).send({ message: "Invalid issue id" });
        if (!staffEmail)
          return res.status(400).send({ message: "Missing staff email" });

        // Update assignedTo and status
        await issuesCollection.updateOne(
          { _id: new ObjectId(issueId) },
          {
            $set: {
              assignedTo: { email: staffEmail, name: staffName || null },
              status: "In-Progress",
            },
          }
        );

        // Add timeline entry using helper
        await addTimelineEntry(issueId, {
          status: "In-Progress",
          message: `Issue assigned to Staff: ${staffName || staffEmail}`,
          updatedBy: req.decoded_email,
          role: "Admin", // adjust if the caller is staff
        });

        res.send({ message: "Staff assigned and timeline updated" });
      } catch (err) {
        console.error("POST /issues/:id/assign error:", err);
        res
          .status(500)
          .send({ message: "Assignment failed", error: err.message });
      }
    });

    // ------------------------
    // GET ALL ISSUES (public)
    // ------------------------
    app.get("/issues", async (req, res) => {
      try {
        const issues = await issuesCollection.find().toArray();
        res.send(issues);
      } catch (e) {
        console.error("GET /issues error:", e);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // ------------------------
    // GET MY ISSUES (public, filters by email param)
    // ------------------------
    app.get("/issues/my-issues/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const issues = await issuesCollection
          .find({ userEmail: email })
          .sort({ createdAt: -1 })
          .toArray();

        res.status(200).send(issues);
      } catch (err) {
        console.error("GET /issues/my-issues error:", err);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // ------------------------
    // GET SINGLE ISSUE (public)
    // ------------------------
    app.get("/issues/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid issue ID" });
        }

        const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });
        if (!issue) return res.status(404).send({ message: "Issue not found" });

        res.send(issue);
      } catch (err) {
        console.error("GET /issues/:id error:", err);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // ------------------------
    // CHANGE STATUS (protected)
    // - body: { status, note }
    // ------------------------
    app.post("/issues/:id/status", async (req, res) => {
      try {
        const issueId = req.params.id;
        const { status, note } = req.body;

        const allowed = ["Pending", "In-Progress", "Resolved", "Closed"];
        if (!allowed.includes(status)) {
          return res.status(400).send({ message: "Invalid status" });
        }

        await issuesCollection.updateOne(
          { _id: new ObjectId(issueId) },
          { $set: { status } }
        );

        await addTimelineEntry(issueId, {
          status,
          message: note || `Status changed to ${status}`,
          updatedBy: req.decoded_email,
          role: "Staff", // or Admin depending on your role logic
        });

        res.send({ message: "Status updated and timeline entry added" });
      } catch (err) {
        console.error("POST /issues/:id/status error:", err);
        res
          .status(500)
          .send({ message: "Status update failed", error: err.message });
      }
    });

    // ------------------------
    // REJECT/CLOSE ISSUE (protected)
    // ------------------------
    app.post("/issues/:id/reject", async (req, res) => {
      try {
        const issueId = req.params.id;
        const { reason } = req.body;

        await issuesCollection.updateOne(
          { _id: new ObjectId(issueId) },
          { $set: { status: "Closed" } }
        );

        await addTimelineEntry(issueId, {
          status: "Closed",
          message: `Issue rejected by admin. Reason: ${
            reason || "Not specified"
          }`,
          updatedBy: req.decoded_email,
          role: "Admin",
        });

        res.send({ message: "Issue rejected and closed" });
      } catch (err) {
        console.error("POST /issues/:id/reject error:", err);
        res.status(500).send({ message: "Reject failed", error: err.message });
      }
    });

    // ------------------------
    // UPVOTE ISSUE (protected)
    // ------------------------
    app.patch("/issues/upvote/:id", async (req, res) => {
      try {
        const issueId = req.params.id;
        const userEmail = req.decoded_email;

        const issue = await issuesCollection.findOne({
          _id: new ObjectId(issueId),
        });
        if (!issue) {
          return res.status(404).send({ message: "Issue not found" });
        }

        if (issue.userEmail === userEmail) {
          return res
            .status(400)
            .send({ message: "You cannot upvote your own issue" });
        }

        // Check if user already upvoted
        const hasVoted = await issuesCollection.findOne({
          _id: new ObjectId(issueId),
          upvotedUsers: userEmail,
        });

        if (hasVoted) {
          return res
            .status(400)
            .send({ message: "You have already upvoted this issue" });
        }

        // Add upvote
        await issuesCollection.updateOne(
          { _id: new ObjectId(issueId) },
          {
            $inc: { upvotes: 1 },
            $push: { upvotedUsers: userEmail },
          }
        );

        // Add a timeline entry for the upvote (optional)
        await addTimelineEntry(issueId, {
          status: issue.status || "Pending",
          message: `Issue upvoted by ${userEmail}`,
          updatedBy: userEmail,
          role: "Citizen",
        });

        res.status(200).send({ message: "Upvoted successfully" });
      } catch (err) {
        console.error("PATCH /issues/upvote/:id error:", err);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // ------------------------
    // DELETE ISSUE (protected)
    // ------------------------
    app.delete("/issues/:id", verifyFbToken, async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid id" });

        const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });
        if (!issue) return res.status(404).send({ message: "Issue not found" });

        if (issue.status !== "Pending")
          return res
            .status(400)
            .send({ message: "Only pending issues can be deleted" });

        // only the owner or admin should delete - here we check owner
        if (issue.userEmail !== req.decoded_email) {
          // add admin check if needed
          return res
            .status(403)
            .send({ message: "Forbidden: only owner can delete" });
        }

        await issuesCollection.deleteOne({ _id: new ObjectId(id) });
        res.status(200).send({ message: "Issue deleted successfully" });
      } catch (err) {
        console.error("DELETE /issues/:id error:", err);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // ------------------------
    // PAYMENT-RELATED ROUTES
    // ------------------------

    // CREATE BOOST SESSION (protected)
    // Frontend calls this to create a Stripe checkout session.
    app.post("/create-boost-session", async (req, res) => {
      try {
        const { issueId, cost, title, userEmail } = req.body;

        if (!issueId || !cost || !title || !userEmail) {
          return res.status(400).json({ message: "Missing required fields" });
        }

        // Ensure email matches authenticated user
        if (userEmail !== req.decoded_email) {
          return res.status(403).json({ message: "Forbidden access" });
        }

        // create stripe session
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd", // change currency if needed
                unit_amount: parseInt(cost, 10) * 100,
                product_data: {
                  name: `Boost Issue: ${title}`,
                },
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          metadata: {
            issueId,
            title,
          },
          customer_email: userEmail,
          success_url: `${process.env.SITE_DOMAIN}/boost-success?session_id={CHECKOUT_SESSION_ID}&issueId=${issueId}`,
          cancel_url: `${process.env.SITE_DOMAIN}/issue/${issueId}`,
        });

        res.json({ url: session.url });
      } catch (err) {
        console.error("POST /create-boost-session error:", err);
        res
          .status(500)
          .json({ message: "Stripe session failed", error: err.message });
      }
    });

    // BOOST SUCCESS (public)
    // Stripe will redirect the user to this endpoint (via success_url).
    // We read the session, update issue priority, insert a payment record,
    // and append a timeline entry.
    app.get("/boost-success", async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        if (!sessionId)
          return res.status(400).send({ message: "Missing session_id" });

        const session = await stripe.checkout.sessions.retrieve(sessionId);

        // Read metadata + customer email
        const issueId = session.metadata && session.metadata.issueId;
        const title = session.metadata && session.metadata.title;
        const email = session.customer_email;

        if (!issueId)
          return res
            .status(400)
            .send({ message: "Missing issueId in session metadata" });

        // Validate issueId
        if (!ObjectId.isValid(issueId))
          return res.status(400).send({ message: "Invalid issueId" });

        // 1) Update issue priority and append a timeline entry (using updateOne push)
        await issuesCollection.updateOne(
          { _id: new ObjectId(issueId) },
          {
            $set: { priority: "High" },
            $push: {
              // keep this push consistent with other timeline shape OR use addTimelineEntry helper
              timeline: {
                status: null,
                message: "Issue boosted by payment",
                updatedBy: email,
                role: "Citizen",
                date: new Date(),
              },
            },
          }
        );

        // 2) Insert payment into payments collection
        await paymentsCollection.insertOne({
          issueId,
          title,
          email,
          amount: session.amount_total ? session.amount_total / 100 : null,
          currency: session.currency || null,
          paymentStatus: session.payment_status || null,
          transactionId: session.id,
          createdAt: new Date(),
        });

        // 3) Also append a timeline entry via helper (optional, duplicates the above push)
        // await addTimelineEntry(issueId, {
        //   status: null,
        //   message: "Issue boosted by payment",
        //   updatedBy: email,
        //   role: "Citizen",
        // });

        res.send({
          message: "Payment Success — Issue Boosted",
          issueId,
          email,
          status: "success",
        });
      } catch (err) {
        console.error("GET /boost-success error:", err);
        res
          .status(500)
          .send({ message: "Boost success failed", error: err.message });
      }
    });

    // OPTIONAL: Get payments for a user (protected)
    app.get("/payments", async (req, res) => {
      try {
        const email = req.query.email;
        if (!email)
          return res.status(400).send({ message: "Missing email query param" });

        // Ensure the requested email is the same as the authenticated user, or add admin override
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "Forbidden access" });
        }

        const payments = await paymentsCollection
          .find({ email })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(payments);
      } catch (err) {
        console.error("GET /payments error:", err);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // End of route registrations inside run()
  } catch (err) {
    console.error("Main run error:", err);
  }
}

run().catch(console.dir);

// =========================
//  START SERVER
// =========================
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
