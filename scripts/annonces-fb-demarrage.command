#!/usr/bin/env bash
# Double-clic : installe (ou réinstalle) la programmation automatique des annonces Facebook.
# À chaque ouverture de session, annonces-fb/planifier.py lance les envois dus et programme ceux du jour à l'heure dite.
cd "$(dirname "$0")" || exit 1
LABEL="fr.analyse-musicale.annonces-fb"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PYTHON="$(command -v python3)"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$PYTHON</string><string>$(pwd)/annonces-fb/planifier.py</string></array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
launchctl bootstrap "gui/$(id -u)" "$PLIST" && echo "Programmation automatique installée (lancée à chaque ouverture de session)."
echo
read -n 1 -s -r -p "Appuyer sur une touche pour fermer…"
