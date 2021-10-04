const dasha = require("@dasha.ai/sdk");
const fs = require("fs");
const express = require( "express" );
const bodyParser = require("body-parser");
const hook = express();
const PORT = 1919;
const json2html = require("node-json2html");
const axios = require("axios").default;

require("dotenv").config();

hook.get('/', (req, res) => {
  res.setHeader("Content-Type", "text/plain");
  res.end("Hello World. Server running on port " + PORT + ". Listening for incidents on http://1543a913a2c7.ngrok.io As soon as incident is identified, I will initiate a call from Dasha AI to ackgnowledge or address the incident. ");
})

hook.use(bodyParser.json());
hook.listen(PORT, () => console.log("🚀 Server running on port ${PORT}"));

// function using nodemailer to send the conversation transcript to yourself 
function sendemail(transcript)
{
  const nodemailer = require('nodemailer');

  var transporter = nodemailer.createTransport(
  {
      service: 'gmail',
      auth: {
        // be sure to specify the credentials in your .env file
        user: process.env.gmailuser,
        pass: process.env.gmailpw
      }
  });

  var mailOptions = 
  {
    from: process.env.gmailuser,
    to: process.env.sendto,
    subject: 'Incident conversation transcript',
    html: '<h2>Conversation transcript:</h2><p>' + transcript + '</p>'
  };

  transporter.sendMail(mailOptions, function(error, info)
  {
      if (error) {
          console.log(error);
      } else {
          console.log('Email sent: ' + info.response);
      }
  });
}

// Dasha app function
async function calldasha(incidentId) 
{
  const app = await dasha.deploy("./app");

  // external functions begin 
  // external functions are called from your Dasha conversation in the body of main.dsl file 
  // external functions can be used for calculations, data storage, in this case, to 
  // call external services with HTTPS requests. You can call an external function from DSL
  // in your node.js file and have it do literally anything you can do with Node.js.

  // External function. Acknowledge an incident in Betteruptime through posting HTTPS  
  app.setExternal("acknowledge", (args, conv) => 
  {
    // this code keeps the code from throwing an error if we are testing with blank data
    if (incidentId === null)
    return;
    
    const config = {
      // remember to set your betteruptimetoken in .env
      headers: { Authorization: "Bearer " + process.env.betteruptimetoken } 
    };

    const bodyParameters = { key: "value" };

    axios.post( "https://betteruptime.com/api/v2/incidents/" + incidentId + "/acknowledge", bodyParameters, config)
    .then(console.log)
    .catch(console.log);
  });

  // External function. Resolve an incident in Betteruptime through posting HTTPS  
  app.setExternal("resolve", (args, conv) => 
  {  
    if (incidentId === null)
    return;

    const config = {
      headers: { Authorization: "Bearer "+ process.env.betteruptimetoken }
    };

    const bodyParameters = { key: "value" };

    axios.post( "https://betteruptime.com/api/v2/incidents/" + incidentId + "/resolve", bodyParameters, config)
    .then(console.log)
    .catch(console.log);
  });

  // external function getting status of additional services 
  app.setExternal("getstatusof", (args, conv) => 
  {
    switch (args.what)
    {
      case "kubernetes":
        return "Kubernetes is up and running";
      case "healthcheck":
        return "Site health checks are not responding";
      case "TLS":
        return "TLS Certificate is active";
    }
  }); 

  // external functions end

  await app.start();

  const conv = app.createConversation({ 
    phone: process.env.phone, 
    name: process.env.name 
  });

  conv.audio.tts = "dasha";

  if (conv.input.phone === "chat") {
    await dasha.chat.createConsoleChat(conv);
  } else {
    conv.on("transcription", console.log);
  }

  if (conv.input.phone !== "chat") conv.on("transcription", console.log);

  const result = await conv.execute();

  console.log(result.output);

  // create directory to save transcriptions
  fs.mkdirSync("transcriptions", { recursive: true } );  
  var transcription = JSON.stringify(result.transcription);

  // save the transcript of the conversation in a file  
  // or you can upload incident transcriptions to your incident management system here
  fs.writeFileSync("transcriptions/" + (incidentId??"test") + ".log", transcription ); 

  // format the JSON to HTML and  email it to yourself
  var transcript = json2html.render(transcription, {"<>": "li", "html":[
    {"<>": "span", "text": "${speaker} at ${startTime}: ${text} "}
    ]});
  sendemail(transcript);

  await app.stop();
  app.dispose();
}

// webhook listener begins 
hook.post("/hook", async(req, res) => 
{
  console.log(req.body); // Call your action on the request here
  res.status(200).end(); // Responding is important
  // save incidentID from JSON as const incidentId 
  // we will need it to send acknowledged and resolved requests to Better Uptime 
  incidentId = req.body.data.id; 
  // we also save acknowledged and resolved statuses.
  // we will need these to keep Dasha from calling you when your incident is acknowledged or resolved
  acknowledged = req.body.data.attributes.acknowledged_at;
  resolved = req.body.data.attributes.resolved_at;
  // log the statuses 
  console.log("incidentID: " + incidentId);
  console.log("acknowledged: " + acknowledged);
  console.log("resolved: " + resolved);

  // Better Uptime sends out webhooks on created, acknowledged, resolved statuses for each incident 
  // we only need to run the Dasha app when the incident is created, thus we do the following: 
  if (acknowledged != null && resolved == null) 
  {
    console.log("Incident " + incidentId + " acknowledged.");
  }
  else if (acknowledged != null && resolved != null)
  {
    console.log("Incident " + incidentId + " resolved.");
  }
  else 
  { 
    console.log("Incident " + incidentId + " created. Expect a call from Dasha.");
    // Launch the function running the Dasha app  
    await calldasha(incidentId);
  }
});

if (process.argv[2] === "test")
  calldasha(null);
