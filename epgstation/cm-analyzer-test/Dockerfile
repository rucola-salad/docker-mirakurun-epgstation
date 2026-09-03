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

RUN cd /tmp && \
    git clone --recursive https://github.com/tobitti0/JoinLogoScpTrialSetLinux.git && \
    cd JoinLogoScpTrialSetLinux && \
    git apply --check /tmp/jlse-avsync-false.patch && \
    git apply /tmp/jlse-avsync-false.patch && \
    grep -n "LWLibavAudioSource" modules/join_logo_scp_trial/src/jlse.js && \
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

WORKDIR /tmp/JoinLogoScpTrialSetLinux/modules/join_logo_scp_trial

COPY server.js /opt/cm-analyzer/server.js

EXPOSE 8080

ENTRYPOINT []
CMD ["node", "/opt/cm-analyzer/server.js"]
