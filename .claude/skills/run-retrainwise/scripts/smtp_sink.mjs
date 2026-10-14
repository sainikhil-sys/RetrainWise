// Local SMTP server that accepts every message and appends it to a file, so the
// app's real nodemailer delivery path runs without a mail provider:
//   node smtp_sink.mjs 2525 /tmp/retrainwise-run/mails.txt
import fs from "node:fs";
import net from "node:net";

const [port = "2525", out = "/tmp/retrainwise-run/mails.txt"] = process.argv.slice(2);

net.createServer((socket) => {
  let buffer = "";
  let mode = "cmd";
  let data = [];
  const reply = (line) => socket.write(`${line}\r\n`);
  reply("220 sink ESMTP");
  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    let i;
    while ((i = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      if (mode === "data") {
        if (line === ".") {
          fs.appendFileSync(out, `${data.join("\n")}\n=====\n`);
          data = [];
          mode = "cmd";
          reply("250 queued");
        } else data.push(line);
        continue;
      }
      if (mode === "login") {
        mode = line ? "login2" : "cmd";
        reply("334 UGFzc3dvcmQ6");
        continue;
      }
      if (mode === "login2") {
        mode = "cmd";
        reply("235 ok");
        continue;
      }
      const verb = line.split(" ")[0].toUpperCase();
      if (verb === "EHLO" || verb === "HELO") socket.write("250-sink\r\n250 AUTH PLAIN LOGIN\r\n");
      else if (verb === "AUTH" && line.split(" ")[1]?.toUpperCase() === "LOGIN") {
        mode = "login";
        reply("334 VXNlcm5hbWU6");
      } else if (verb === "AUTH") reply("235 ok");
      else if (verb === "DATA") {
        mode = "data";
        reply("354 go");
      } else if (verb === "QUIT") {
        reply("221 bye");
        socket.end();
      } else reply("250 ok");
    }
  });
  socket.on("error", () => {});
}).listen(Number(port), "127.0.0.1");
