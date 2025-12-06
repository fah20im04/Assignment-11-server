const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;
require("dotenv").config();

// middlewere
app.use(express.json());
app.use(cors());

const { MongoClient, ServerApiVersion } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.qvklz1c.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );

    // collections
    const db = client.db("public_Infrastructure_user");
    const usersCollection = db.collection("users");
    // users related api
    app.post("/users", async (req, res) => {
      try {
        
        const user = req.body;
        // user.role = "user";
        user.createdAt = new Date();
        const email = user.email;

        const userExists = await usersCollection.findOne({ email });

        if (userExists) {
          // User already exists
          return res.status(409).send({ message: "User already exists" });
        }

        // New user - insert
        const result = await usersCollection.insertOne(user);

        return res.status(201).send({
          message: "User created successfully",
          userId: result.insertedId,
        });
      } catch (error) {
        console.error("Error in /users:", error);
        return res.status(500).send({ message: "Internal server error" });
      }
    });
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("My app is running");
});

app.listen(port, () => {
  console.log(`app is running on port ${port}`);
});
