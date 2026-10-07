; Stops the bundled database and services before files are replaced or
; removed: a PostgreSQL left running (after a crash, say) would lock them.
; Only our own cluster is stopped, by its data folder, never another
; PostgreSQL on the computer.

!macro shamiyanaStopServices
  IfFileExists "$INSTDIR\resources\pgsql\bin\pg_ctl.exe" 0 +2
    nsExec::Exec '"$INSTDIR\resources\pgsql\bin\pg_ctl.exe" stop -m fast -w -D "$LOCALAPPDATA\Shamiyana\pgdata"'
  nsExec::Exec 'taskkill /F /IM gotrue.exe'
  nsExec::Exec 'taskkill /F /IM postgrest.exe'
!macroend

!macro customInit
  !insertmacro shamiyanaStopServices
!macroend

!macro customUnInit
  !insertmacro shamiyanaStopServices
!macroend
