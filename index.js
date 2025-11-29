require("dotenv").config();
const express = require("express");
const cors = require("cors");
const dns = require("dns");
const url = require("url");
const mongoose = require("mongoose");

const app = express();

// Middlewares para parsear body (formularios y JSON)
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use(cors());
app.use("/public", express.static(`${process.cwd()}/public`));

// --- MongoDB setup ---------------------------------------------------------
const MONGO_URI = process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error(
    "MONGODB_URI no definida en Secrets. Asegúrate de configurarla en Replit o en .env",
  );
  process.exit(1);
}

mongoose.set("strictQuery", false);

// Esquema y modelos: Usaremos dos colecciones: Url y Counter
const urlSchema = new mongoose.Schema({
  original_url: { type: String, required: true },
  short_url: { type: Number, required: true, unique: true },
});
const Url = mongoose.model("Url", urlSchema);

// Contador para generar short_url incrementales
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});
const Counter = mongoose.model("Counter", counterSchema);

async function getNextSequence(name) {
  // findOneAndUpdate con upsert y retorno del documento actualizado
  const ret = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  ).exec();
  return ret.seq;
}

async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Conectado a MongoDB correctamente");
  } catch (err) {
    console.error("Error al conectar a MongoDB:", err);
    process.exit(1);
  }
}

// --- Rutas públicas -------------------------------------------------------
app.get("/", function (req, res) {
  res.sendFile(process.cwd() + "/views/index.html");
});

// Endpoint de ejemplo
app.get("/api/hello", function (req, res) {
  res.json({ greeting: "hello API" });
});

// --- Helpers --------------------------------------------------------------
function isValidHttpUrl(input) {
  // Comprueba esquema http(s) y que el hostname exista (sin hacer request)
  try {
    const parsed = new URL(input);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (e) {
    return false;
  }
}

// Extrae el hostname para dns.lookup (sin puerto ni path)
function getHostname(input) {
  try {
    const parsed = new URL(input);
    return parsed.hostname;
  } catch (e) {
    return null;
  }
}

// --- API: POST /api/shorturl ----------------------------------------------
app.post("/api/shorturl", async (req, res) => {
  const original_url = req.body.url || req.body.original_url || req.body.input;

  if (!original_url || !isValidHttpUrl(original_url)) {
    return res.json({ error: "invalid url" });
  }

  const hostname = getHostname(original_url);
  if (!hostname) {
    return res.json({ error: "invalid url" });
  }

  // Verificar existencia del hostname usando dns.lookup
  dns.lookup(hostname, async (err /*, address, family */) => {
    if (err) {
      // Hostname no resolvible
      return res.json({ error: "invalid url" });
    }

    try {
      // Si ya existe, devolver la entrada existente
      const existing = await Url.findOne({ original_url }).exec();
      if (existing) {
        return res.json({
          original_url: existing.original_url,
          short_url: existing.short_url,
        });
      }

      // Generar nuevo short_url usando counter
      const nextSeq = await getNextSequence("url_count");
      const newUrl = new Url({
        original_url,
        short_url: nextSeq,
      });
      await newUrl.save();

      return res.json({
        original_url: newUrl.original_url,
        short_url: newUrl.short_url,
      });
    } catch (dbErr) {
      console.error("DB error:", dbErr);
      return res.status(500).json({ error: "server error" });
    }
  });
});

// --- API: GET /api/shorturl/:short_url -----------------------------------
app.get("/api/shorturl/:short_url", async (req, res) => {
  const short = Number(req.params.short_url);
  if (!Number.isFinite(short)) {
    return res.json({ error: "invalid url" });
  }

  try {
    const entry = await Url.findOne({ short_url: short }).exec();
    if (!entry) {
      return res
        .status(404)
        .json({ error: "No short URL found for given input" });
    }
    // Redirigir a la URL original
    return res.redirect(entry.original_url);
  } catch (err) {
    console.error("DB error:", err);
    return res.status(500).json({ error: "server error" });
  }
});

// --- Start server después de conectar a la DB -----------------------------
function startServer() {
  const port = process.env.PORT || 3000;
  const listener = app.listen(port, () => {
    console.log("Your app is listening on port " + listener.address().port);
  });
}

connectDB()
  .then(startServer)
  .catch((err) => {
    console.error("Error en connectDB():", err);
    process.exit(1);
  });
