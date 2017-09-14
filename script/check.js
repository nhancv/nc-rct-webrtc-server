//Redirect to https:
if(window.location.host.indexOf("herokuapp") >=0 && window.location.protocol.indexOf("https") < 0) {
  window.location.href = "https://nc-rct-webrtc-server.herokuapp.com" + window.location.pathname;
}

//Chrome
const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
if(!isChrome) {
  alert("Please open this page in Chrome Browser!");
}
