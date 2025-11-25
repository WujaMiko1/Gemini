@set SyntecRemoteAgentVer=%1


@pushd LatestAgent\
..\7-Zip\7za.exe x SyntecRemoteAgent_%SyntecRemoteAgentVer%.zip
@popd

@del *.dll
@del *.exe
@rd /s /q image


@md image
@xcopy LatestAgent\SyntecRemoteAgent\*.dll  /Y /I /E
@xcopy LatestAgent\SyntecRemoteAgent\*.exe  /Y /I /E
@xcopy LatestAgent\SyntecRemoteAgent\image\*.png image\ /Y /I /E

@rd /q /s LatestAgent\SyntecRemoteAgent

@start SyntecRemoteAgent.exe