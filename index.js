require('dotenv').config()
const config = require('./bitserve.json')
const express = require('express')
const bitqueryd = require('bitqueryd')
const PQueue = require('p-queue')
const ip = require('ip')
const app = express()
const rateLimit = require("express-rate-limit")
const cors = require("cors")
const concurrency = ((config.concurrency && config.concurrency.aggregate) ? config.concurrency.aggregate : 3)
const queue = new PQueue({concurrency: concurrency})
var db

app.set('view engine', 'ejs')
app.use(express.static('public'))

// create rate limiter for API endpoint,ß bypass whitelisted IPs
var whitelist = []
if (process.env.whitelist) {
  whitelist = process.env.whitelist.split(',')
}
app.use(cors())
app.enable("trust proxy")
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 60, // 60 requests per windowMs
  handler: function(req, res, /*next*/) {
    res.format({
      json: function() {
        res.status(500).json({
          error: "Too many requests. Limits are 60 requests per minute."
        })
      }
    })
  },
  skip: function (req, /*res*/) {
    if (whitelist.includes(req.ip)) {
      return true
    }
    return false
  }
})
app.get(/^\/q\/(.+)/, cors(), limiter, async function(req, res) {
  var encoded = req.params[0];
  let r = JSON.parse(new Buffer(encoded, "base64").toString());
  if (r.q && r.q.aggregate) {
    // add to aggregate queue
    console.log("# Aggregate query. Adding to queue", queue.size)
    queue.add(async function() {
      // regular read
      let result = await db.read(r)
      if (process.env.bitserve_log) {
        console.log("query = ", r)
        console.log("response = ", result)
      }
      console.log("Done", queue.size-1)
      res.json(result)
    })
  } else {
    // regular read
    let result = await db.read(r)
    if (process.env.bitserve_log) {
      console.log("query = ", r)
      console.log("response = ", result)
    }
    res.json(result)
  }
})
app.get(/^\/explorer\/(.+)/, function(req, res) {
  let encoded = req.params[0]
  let decoded = Buffer.from(encoded, 'base64').toString()
  res.render('explorer', { code: decoded })
});
app.get('/explorer', function (req, res) {
  res.render('explorer', { code: JSON.stringify({
    "v": 3,
    "q": { "find": {}, "limit": 10 }
  }, null, 2) })
});
app.get('/', function(req, res) {
  res.redirect('/explorer')
});
var run = async function() {
  db = await bitqueryd.init({
    url: (process.env.db_url ? process.env.db_url : process.env.db_url),
    timeout: process.env.bitserve_timeout ? process.env.bitserve_timeout : 30000,
    name: process.env.db_name ? process.env.db_name : "bitdb"
  })
  app.listen(process.env.bitserve_port, () => {
    console.log("######################################################################################");
    console.log("#")
    console.log("#  BITSERVE: BitDB Microservice")
    console.log("#  Serving Bitcoin through HTTP...")
    console.log("#")
    console.log(`#  Explorer: ${ip.address()}:${process.env.bitserve_port}/explorer`);
    console.log(`#  API Endpoint: ${ip.address()}:${process.env.bitserve_port}/q`);
    console.log("#")
    console.log("#  Learn more at https://docs.bitdb.network")
    console.log("#")
    console.log("######################################################################################");
  })
}
run()
