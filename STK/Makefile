CC = clang++
CFLAGS = -Wall -O2
TARGET = test
SRCS = test.cpp utilities.cpp Clarinet.cpp Delay.cpp DelayL.cpp Envelope.cpp Noise.cpp OnePole.cpp OneZero.cpp JCRev.cpp SineWave.cpp Voicer.cpp Messager.cpp Skini.cpp Stk.cpp FileWrite.cpp FileWvOut.cpp
OBJS = $(SRCS:.cpp=.o)

all: $(TARGET)

$(TARGET): $(OBJS)
	$(CC) $(CFLAGS) -o $@ $(OBJS)

%.o: %.cpp
	$(CC) $(CFLAGS) -c $< -o $@

clean:
	rm -f $(TARGET) $(OBJS) test.wav

.PHONY: all clean
