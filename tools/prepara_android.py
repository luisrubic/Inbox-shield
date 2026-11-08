"""Dopo `flutter create`: permesso internet e traffico http (il server è sul tuo portatile)."""
import pathlib, re, sys

m = pathlib.Path("android/app/src/main/AndroidManifest.xml")
t = m.read_text(encoding="utf-8")
if "android.permission.INTERNET" not in t:
    t = t.replace("<application", '<uses-permission android:name="android.permission.INTERNET"/>\n    <application', 1)
if "usesCleartextTraffic" not in t:
    t = t.replace("<application", '<application android:usesCleartextTraffic="true"', 1)
if "<queries>" not in t:
    t = t.replace("<application", '<queries><intent><action android:name="android.intent.action.VIEW"/><data android:scheme="https"/></intent></queries>\n    <application', 1)
m.write_text(t, encoding="utf-8")
g = pathlib.Path("android/app/build.gradle")
g2 = pathlib.Path("android/app/build.gradle.kts")
for f in (g, g2):
    if f.exists():
        s = f.read_text(encoding="utf-8")
        s = re.sub(r"minSdk(Version)?\s*=?\s*(flutter\.minSdkVersion|\d+)", "minSdk = 23" if f.suffix == ".kts" else "minSdkVersion 23", s)
        f.write_text(s, encoding="utf-8")
print("Android pronto")
