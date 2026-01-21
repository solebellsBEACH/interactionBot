import { Collection, Db, Document, MongoClient } from "mongodb";

const DEFAULT_URI = "mongodb://root:example@localhost:27017";
const DEFAULT_DB = "interactionbot";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectToDatabase(): Promise<Db> {
  if (db) return db;

  const uri = process.env.MONGO_URI || DEFAULT_URI;
  const dbName = process.env.MONGO_DB_NAME || DEFAULT_DB;

  client = new MongoClient(uri);
  await client.connect();

  db = client.db(dbName);
  console.log(`MongoDB conectado em ${uri}, usando DB "${dbName}".`);

  return db;
}

export function getDb(): Db {
  if (!db) {
    throw new Error("MongoDB não conectado. Chame connectToDatabase() primeiro.");
  }

  return db;
}

export async function getCollection<TSchema extends Document = Document>(name: string): Promise<Collection<TSchema>> {
  const database = await connectToDatabase();
  return database.collection<TSchema>(name);
}

export async function disconnectFromDatabase(): Promise<void> {
  if (client) {
    await client.close();
  }

  client = null;
  db = null;
}
