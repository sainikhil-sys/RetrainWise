"""Local SMTP server that accepts every message and appends it to a file.

Lets the app's real smtplib delivery path run without a mail provider:
    python smtp_sink.py 2525 /tmp/retrainwise-run/mails.txt
"""
import base64
import socketserver
import sys


class Handler(socketserver.StreamRequestHandler):
    def reply(self, line):
        self.wfile.write((line + "\r\n").encode())

    def handle(self):
        self.reply("220 sink ESMTP")
        while line := self.rfile.readline().decode().rstrip("\r\n"):
            verb = line.split(" ", 1)[0].upper()
            if verb in ("EHLO", "HELO"):
                self.reply("250-sink")
                self.reply("250 AUTH PLAIN LOGIN")
            elif verb == "AUTH":
                if line.split()[1].upper() == "LOGIN":
                    for prompt in ("334 VXNlcm5hbWU6", "334 UGFzc3dvcmQ6"):
                        self.reply(prompt)
                        base64.b64decode(self.rfile.readline().strip())
                self.reply("235 ok")
            elif verb == "DATA":
                self.reply("354 go")
                body = []
                while (chunk := self.rfile.readline().decode()) not in (".\r\n", ""):
                    body.append(chunk)
                with open(sys.argv[2], "a", encoding="utf-8") as out:
                    out.write("".join(body) + "\n=====\n")
                self.reply("250 queued")
            elif verb == "QUIT":
                self.reply("221 bye")
                return
            else:
                self.reply("250 ok")


if __name__ == "__main__":
    server = socketserver.ThreadingTCPServer(("127.0.0.1", int(sys.argv[1])), Handler)
    server.daemon_threads = True
    server.serve_forever()
