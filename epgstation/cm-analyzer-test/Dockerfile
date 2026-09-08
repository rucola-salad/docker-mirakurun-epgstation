FROM ghcr.io/tobitti0/docker-avisynthplus:4.3.1-ubuntu2004

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install --no-install-recommends -y \
      git \
      make \
      gcc \
      g++ \
      cmake \
      curl \
      nodejs \
      npm \
      libboost-all-dev && \
    rm -rf /var/lib/apt/lists/*

COPY patches/jlse-avsync-false.patch /tmp/jlse-avsync-false.patch
COPY patches/jlse-nologo.patch /tmp/jlse-nologo.patch
COPY patches/jlse-audio-auto.patch /tmp/jlse-audio-auto.patch

RUN cd /tmp && \
    git clone --recursive https://github.com/tobitti0/JoinLogoScpTrialSetLinux.git && \
    cd JoinLogoScpTrialSetLinux && \
    git apply --check /tmp/jlse-avsync-false.patch && \
    git apply /tmp/jlse-avsync-false.patch && \
    git -C modules/join_logo_scp_trial apply --check /tmp/jlse-nologo.patch && \
    git -C modules/join_logo_scp_trial apply /tmp/jlse-nologo.patch && \
    git apply --check /tmp/jlse-audio-auto.patch && \
    git apply /tmp/jlse-audio-auto.patch && \
    grep -n "LWLibavAudioSource" modules/join_logo_scp_trial/src/jlse.js && \
    grep -n "nologo" modules/join_logo_scp_trial/src/jlse.js && \
    cd modules/chapter_exe/src && \
    make && \
    mv chapter_exe ../../join_logo_scp_trial/bin/ && \
    cd ../../logoframe/src && \
    make && \
    mv logoframe ../../join_logo_scp_trial/bin/ && \
    cd ../../join_logo_scp/src && \
    make && \
    mv join_logo_scp ../../join_logo_scp_trial/bin/

RUN cd /tmp/JoinLogoScpTrialSetLinux/modules/join_logo_scp_trial && \
    npm install && \
    npm link

COPY genlogo/genlogo.cpp /tmp/genlogo.cpp

RUN g++ \
      -std=c++17 \
      -O2 \
      /tmp/genlogo.cpp \
      -o /usr/local/bin/genlogo && \
    chmod 0755 /usr/local/bin/genlogo

WORKDIR /tmp/JoinLogoScpTrialSetLinux/modules/join_logo_scp_trial

COPY server.js /opt/cm-analyzer/server.js

EXPOSE 8080

ENTRYPOINT []
CMD ["node", "/opt/cm-analyzer/server.js"]
