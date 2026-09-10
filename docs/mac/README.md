# Keeping the desktop project folder current

The desktop project's shell cannot modify tracked files, so it can never
`git pull`. This launchd agent does it instead, every 15 minutes and at
login, fast forward only, and refuses to touch the folder if it is not
on main or has local tracked changes. Install once, in Terminal:

```
cd ~/GHRepositories/Cray_Cray_Parlay_App
rm -f .git/index.lock && git pull
cp docs/mac/com.traphawk.pull.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.traphawk.pull.plist 2>/dev/null
launchctl load ~/Library/LaunchAgents/com.traphawk.pull.plist
tail -3 ~/Library/Logs/traphawk-pull.log
```

The last line should show a "pulled <sha>" entry within a few seconds.
From then on the folder tracks main on its own, and the log at
`~/Library/Logs/traphawk-pull.log` is the witness. To stop it:
`launchctl unload ~/Library/LaunchAgents/com.traphawk.pull.plist`.
