/** Shared normal-flow dock: opening either panel increases its height and
 * moves the next panel, rather than covering another disclosure/control. */
export function mountFlightPanel(panel: HTMLElement): void {
  let dock=document.getElementById('flight-panel-dock')
  if(!dock){
    dock=document.createElement('aside')
    dock.id='flight-panel-dock'
    dock.setAttribute('aria-label','Flight setup panels')
    Object.assign(dock.style,{
      position:'fixed',top:'54px',right:'8px',zIndex:'31',
      width:'min(440px, calc(100vw - 16px))',maxHeight:'calc(100dvh - 68px)',
      display:'flex',flexDirection:'column',gap:'8px',overflowY:'auto',overflowX:'hidden',
    })
    document.body.appendChild(dock)
  }
  Object.assign(panel.style,{
    position:'relative',top:'auto',right:'auto',left:'auto',bottom:'auto',
    width:'100%',maxWidth:'100%',minWidth:'0',maxHeight:'none',boxSizing:'border-box',
    flex:'0 0 auto',overflowWrap:'anywhere',
  })
  dock.appendChild(panel)
}
